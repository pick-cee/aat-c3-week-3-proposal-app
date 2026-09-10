"use server";

import { revalidatePath } from "next/cache";
import { Resend } from "resend";

import { logActivity } from "@/lib/activity";
import { requireProfile } from "@/lib/auth";
import { getAdminClient } from "@/lib/db/admin";
import { getServerClient } from "@/lib/db/server";
import type { Delivery, Proposal, ProposalSection } from "@/lib/db/types";
import { placeholderWarning } from "@/lib/policy/placeholders";
import { classifySendFailure, rawErrorText } from "@/lib/email/classify";
import { composeClientEmail } from "@/lib/email/template";
import { env, resolveRecipient } from "@/lib/env";
import { RuleViolation } from "@/lib/errors";
import { assertSendable } from "@/lib/guards";


export interface SendResult {
  ok: boolean;
  /**
   * The document still carries `[To be confirmed]`. Not a failure — the send
   * has not been attempted, and will proceed if the salesperson confirms.
   */
  needsPlaceholderAck?: boolean;
  /** Plain-language cause when it failed. */
  reason?: string;
  /** Whether to offer a retry button. */
  retryable?: boolean;
  /** Where it actually went, so the UI can confirm the demo redirect. */
  sentTo?: string;
}

export async function sendProposal(
  proposalId: string,
  /**
   * The salesperson has seen that the document still carries
   * `[To be confirmed]` and is sending anyway.
   *
   * Required rather than assumed: the Warn tier asked at generation time and
   * never again, so without this a placeholder agreed to hours earlier reaches
   * a client with nobody having looked at it since.
   */
  acknowledgePlaceholders = false,
): Promise<SendResult> {
  const actor = await requireProfile();
  const db = await getServerClient();

  const { data } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (!data) throw new RuleViolation("Proposal not found.", "not_found");

  const proposal = data as Proposal;
  assertSendable(proposal, actor);

  /*
    A superseded version must not be sent.

    `assertSendable` asks whether this row is approved and whether this person
    wrote it. Both can be true of a version that has since been continued: v3
    was approved, then forked to v4, and v3 stays `approved` forever because
    that is the entire point of freezing it.

    Sending it would deliver the superseded document while the real work sits
    in v4 — and because the share token resolves to the most recent *sent*
    version, it would also drag every client who already has the link back to
    the older text. That is the one thing the token design exists to prevent.

    Checked here rather than in `assertSendable` because it needs the database;
    the guard is pure. This is the enforcement, not the button.
  */
  const { data: successor } = await db
    .from("proposals")
    .select("id, version")
    .eq("parent_id", proposalId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (successor) {
    throw new RuleViolation(
      `Version ${proposal.version} has been continued as version ` +
      `${successor.version}, so it is out of date. Send version ` +
      `${successor.version} instead — sending this one would give the client ` +
      "the older document.",
      "superseded",
    );
  }

  // Last gate before the client. Refused rather than blocked — the caller can
  // send again having acknowledged it.
  const { data: sectionRows } = await db
    .from("proposal_sections")
    .select("*")
    .eq("proposal_id", proposalId);

  const placeholders = placeholderWarning(
    (sectionRows ?? []) as ProposalSection[],
  );

  if (placeholders && !acknowledgePlaceholders) {
    return {
      ok: false,
      reason: placeholders,
      retryable: true,
      needsPlaceholderAck: true,
    };
  }

  const recipient = proposal.client_email?.trim();
  if (!recipient) {
    // Blocked by the intake policy long before here, but a proposal that
    // reached `approved` without one would otherwise fail inside Resend with a
    // less useful message.
    return {
      ok: false,
      reason:
        "There is no client email address on this proposal. Add one to the " +
        "intake before sending.",
      retryable: true,
    };
  }

  const { intended, actual, demoMode } = resolveRecipient(recipient);

  const proposalUrl = `${env.NEXT_PUBLIC_SITE_URL}/p/${proposal.share_token}`;
  const email = composeClientEmail(proposal, proposalUrl);

  try {
    const resend = new Resend(env.RESEND_API_KEY);

    const { data: sent, error } = await resend.emails.send({
      from: env.RESEND_FROM_ADDRESS,
      to: actual,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    // Resend returns errors in the payload rather than throwing, which is easy
    // to miss and would otherwise look like a successful send.
    if (error) throw error;

    return await recordSuccess({
      proposalId,
      intended,
      actual,
      demoMode,
      providerMessageId: sent?.id ?? null,
      actorName: actor.full_name,
    });
  } catch (error) {
    return await recordFailure({
      proposalId,
      intended,
      actual,
      demoMode,
      error,
      actorName: actor.full_name,
    });
  }
}

async function recordSuccess(args: {
  proposalId: string;
  intended: string;
  actual: string;
  demoMode: boolean;
  providerMessageId: string | null;
  actorName: string;
}): Promise<SendResult> {
  const db = await getServerClient();

  // Delivery rows are written with the SERVICE ROLE, deliberately.
  //
  // `deliveries` has a read policy and no insert policy — RLS denies by
  // default, so the row silently failed to write and the send reported "an
  // unexpected error" for what was actually a permissions rule. The policy is
  // right and the client was wrong: a delivery record is a statement about
  // what the system did, not about what a user typed, and a user who could
  // write these could claim a proposal was sent when it never was.
  const admin = getAdminClient();

  const { error } = await admin.from("deliveries").insert({
    proposal_id: args.proposalId,
    intended_recipient: args.intended,
    actual_recipient: args.actual,
    demo_mode: args.demoMode,
    status: "sent",
    provider_message_id: args.providerMessageId,
  });

  if (error) {
    // The partial unique index refused a second success for this version. The
    // email HAS gone out — twice now — but the database is the source of truth
    // about what the client received, and it is telling us this was already
    // delivered. Recorded honestly rather than hidden.
    if (isUniqueViolation(error)) {
      await logActivity({
        proposalId: args.proposalId,
        actorName: args.actorName,
        event: "sent",
        detail:
          "A duplicate send was attempted and refused by the database. The " +
          "client may have received two copies — check before sending again.",
      });

      return {
        ok: false,
        reason:
          "This version had already been sent. The database refused to record " +
          "a second delivery, which is what stops a client receiving the same " +
          "proposal twice.",
        retryable: false,
      };
    }

    throw new Error(`Could not record the delivery: ${error.message}`);
  }

  await db
    .from("proposals")
    .update({ status: "sent" })
    .eq("id", args.proposalId);

  await logActivity({
    proposalId: args.proposalId,
    actorName: args.actorName,
    event: "sent",
    detail: args.demoMode
      ? `Sent to ${args.actual} (demo mode; intended recipient was ${args.intended}).`
      : `Sent to ${args.actual}.`,
  });

  revalidatePath(`/proposals/${args.proposalId}`);
  revalidatePath("/queue");

  return { ok: true, sentTo: args.actual };
}

async function recordFailure(args: {
  proposalId: string;
  intended: string;
  actual: string;
  demoMode: boolean;
  error: unknown;
  actorName: string;
}): Promise<SendResult> {
  const admin = getAdminClient();
  const classified = classifySendFailure(args.error);

  // Every attempt, successful or not, is a row. Three failed attempts followed
  // by a success is a story someone can read later.
  const { data: recorded } = await admin
    .from("deliveries")
    .insert({
    proposal_id: args.proposalId,
    intended_recipient: args.intended,
    actual_recipient: args.actual,
    demo_mode: args.demoMode,
    status: "failed",
    error: rawErrorText(args.error),
    failure_reason: classified.reason,
    retryable: classified.retryable,
    })
    // Read the attempt number back: the trigger assigns it, so this is the
    // only place that knows what it actually is.
    .select("attempt")
    .single();

  await logActivity({
    proposalId: args.proposalId,
    actorName: args.actorName,
    event: "send_failed",
    detail: `Attempt ${recorded?.attempt ?? "?"}: ${classified.reason}`,
  });

  // The proposal stays `approved`. It never silently reverts to draft, because
  // it WAS approved and that decision still stands. The failure banner is
  // derived from these delivery rows.
  revalidatePath(`/proposals/${args.proposalId}`);
  revalidatePath("/queue");

  return {
    ok: false,
    reason: classified.reason,
    retryable: classified.retryable,
  };
}


function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "23505" ||
    /duplicate key|unique constraint/i.test(error.message ?? "")
  );
}

/** Delivery history for a proposal, newest first. */
export async function loadDeliveries(proposalId: string): Promise<Delivery[]> {
  const db = await getServerClient();

  const { data } = await db
    .from("deliveries")
    .select("*")
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: false });

  return (data ?? []) as Delivery[];
}
