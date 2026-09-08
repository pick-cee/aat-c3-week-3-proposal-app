"use server";

import { revalidatePath } from "next/cache";
import { Resend } from "resend";

import { logActivity } from "@/lib/activity";
import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import type { Delivery, Proposal } from "@/lib/db/types";
import { classifySendFailure, rawErrorText } from "@/lib/email/classify";
import { composeClientEmail } from "@/lib/email/template";
import { env, resolveRecipient } from "@/lib/env";
import { RuleViolation } from "@/lib/errors";
import { assertSendable } from "@/lib/guards";


export interface SendResult {
  ok: boolean;
  /** Plain-language cause when it failed. */
  reason?: string;
  /** Whether to offer a retry button. */
  retryable?: boolean;
  /** Where it actually went, so the UI can confirm the demo redirect. */
  sentTo?: string;
}

export async function sendProposal(proposalId: string): Promise<SendResult> {
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
  const attempt = await nextAttemptNumber(proposalId);

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
      attempt,
      providerMessageId: sent?.id ?? null,
      actorName: actor.full_name,
    });
  } catch (error) {
    return await recordFailure({
      proposalId,
      intended,
      actual,
      demoMode,
      attempt,
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
  attempt: number;
  providerMessageId: string | null;
  actorName: string;
}): Promise<SendResult> {
  const db = await getServerClient();

  const { error } = await db.from("deliveries").insert({
    proposal_id: args.proposalId,
    intended_recipient: args.intended,
    actual_recipient: args.actual,
    demo_mode: args.demoMode,
    status: "sent",
    provider_message_id: args.providerMessageId,
    attempt: args.attempt,
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
  attempt: number;
  error: unknown;
  actorName: string;
}): Promise<SendResult> {
  const db = await getServerClient();
  const classified = classifySendFailure(args.error);

  // Every attempt, successful or not, is a row. Three failed attempts followed
  // by a success is a story someone can read later.
  await db.from("deliveries").insert({
    proposal_id: args.proposalId,
    intended_recipient: args.intended,
    actual_recipient: args.actual,
    demo_mode: args.demoMode,
    status: "failed",
    error: rawErrorText(args.error),
    failure_reason: classified.reason,
    retryable: classified.retryable,
    attempt: args.attempt,
  });

  await logActivity({
    proposalId: args.proposalId,
    actorName: args.actorName,
    event: "send_failed",
    detail: `Attempt ${args.attempt}: ${classified.reason}`,
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

async function nextAttemptNumber(proposalId: string): Promise<number> {
  const db = await getServerClient();

  const { count } = await db
    .from("deliveries")
    .select("id", { count: "exact", head: true })
    .eq("proposal_id", proposalId);

  return (count ?? 0) + 1;
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
