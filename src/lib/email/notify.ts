import "server-only";

import { Resend } from "resend";

import { getAdminClient } from "@/lib/db/admin";
import type { Profile, Proposal } from "@/lib/db/types";
import { env, resolveRecipient } from "@/lib/env";

/**
 * Internal notifications — the handoffs between the two people in this system.
 *
 * A workflow that depends on someone refreshing a page is not a workflow. The
 * whole point of separation of duties is that work passes between two people,
 * and every one of those passes was previously silent: submitting set a status
 * and redirected, and approving or rejecting did the same in the other
 * direction. Each time, the person now holding the work found out by happening
 * to look. `STALE_IN_REVIEW_HOURS` surfaces a forgotten proposal after two
 * days — on the queue, to the person who is not looking at it.
 *
 * Two rules hold for all of these:
 *
 *   They go through the same demo redirect as client mail. A demo application
 *   must not be able to email a stranger, and an address in a seeded database
 *   is exactly the kind that could belong to someone real.
 *
 *   They never throw. The state transition has already happened and is correct
 *   in the database; an email provider being down must not roll it back or
 *   show someone an error about work that succeeded.
 */

/** Resolves profile ids to addresses. Emails live on auth.users, not profiles. */
async function addressesFor(
  profiles: Profile[],
): Promise<Array<{ profile: Profile; address: string }>> {
  const db = getAdminClient();
  const { data: users } = await db.auth.admin.listUsers();
  const emailById = new Map((users?.users ?? []).map((u) => [u.id, u.email]));

  return profiles
    .map((profile) => ({ profile, address: emailById.get(profile.id) }))
    .filter((r): r is { profile: Profile; address: string } =>
      Boolean(r.address),
    );
}

/**
 * One notification. Failure is logged and swallowed — see the rule above.
 *
 * The demo redirect is applied here rather than at each call site so no future
 * notification can forget it.
 */
async function notify(
  address: string,
  subject: string,
  lines: string[],
): Promise<void> {
  try {
    const { actual } = resolveRecipient(address);
    const resend = new Resend(env.RESEND_API_KEY);

    await resend.emails.send({
      from: env.RESEND_FROM_ADDRESS,
      to: actual,
      subject,
      text: lines.join("\n"),
    });
  } catch (error) {
    console.error(
      `[notify] "${subject}" to ${address} failed: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function firstNameOf(profile: Profile): string {
  return profile.full_name.split(" ")[0] ?? profile.full_name;
}

function proposalUrl(proposal: Proposal, path = ""): string {
  return `${env.NEXT_PUBLIC_SITE_URL}/proposals/${proposal.id}${path}`;
}

/**
 * Submitted for review — tell the approvers.
 *
 * The author is skipped even if they hold the approver role: they cannot
 * approve their own work, so telling them it is waiting for them would be
 * worse than silence.
 */
export async function notifyApprovers(
  proposal: Proposal,
  submittedBy: string,
): Promise<void> {
  // The service role, deliberately: a salesperson has no RLS visibility of
  // other people's profiles, and finding out who the approvers are is a
  // legitimate thing for the system to do on their behalf.
  const db = getAdminClient();

  const { data } = await db.from("profiles").select("*").eq("role", "approver");

  const approvers = ((data ?? []) as Profile[]).filter(
    (a) => a.id !== proposal.author_id,
  );

  if (approvers.length === 0) return;

  const company = proposal.company_name ?? "a client";

  for (const { profile, address } of await addressesFor(approvers)) {
    await notify(
      address,
      `Ready for your review: ${proposal.company_name ?? "a proposal"}`,
      [
        `Hi ${firstNameOf(profile)},`,
        "",
        `${submittedBy} has submitted a proposal for ${company} and it is`,
        "waiting on your review.",
        "",
        proposalUrl(proposal, "/review"),
        "",
        "You can approve it, or send it back with notes on the sections that",
        "need work. Nothing reaches the client until you decide.",
      ],
    );
  }
}

/**
 * Decided — tell the salesperson who wrote it.
 *
 * This is the leg that was missing entirely. The approver acts and the
 * salesperson is the one who has to do something about it: send it, or fix it.
 * Being the person blocked while not knowing you are blocked is the worst seat
 * in the workflow.
 *
 * Only the author is written to. An approval is not news to the approver who
 * just made it, and other salespeople have no stake in this proposal.
 */
export async function notifyAuthorOfDecision(
  proposal: Proposal,
  decision: "approved" | "changes_requested",
  decidedBy: string,
  note: string | null,
  /** How many sections carry their own note, for the rejection case. */
  sectionNoteCount = 0,
): Promise<void> {
  const db = getAdminClient();

  const { data } = await db
    .from("profiles")
    .select("*")
    .eq("id", proposal.author_id)
    .maybeSingle();

  if (!data) return;

  const resolved = await addressesFor([data as Profile]);
  if (resolved.length === 0) return;

  const { profile, address } = resolved[0]!;
  const company = proposal.company_name ?? "a client";

  if (decision === "approved") {
    await notify(address, `Approved: ${company}`, [
      `Hi ${firstNameOf(profile)},`,
      "",
      `${decidedBy} approved your proposal for ${company}.`,
      "",
      // The next action is the salesperson's, and it is not automatic —
      // sending belongs to them by design, so the mail has to say so or an
      // approved proposal sits waiting for a step nobody knows to take.
      "It is ready to send. Nothing goes to the client until you send it:",
      "",
      proposalUrl(proposal),
      ...(note ? ["", `Their note: ${note}`] : []),
    ]);
    return;
  }

  const where =
    sectionNoteCount > 0
      ? `${sectionNoteCount} section${sectionNoteCount === 1 ? "" : "s"} ` +
        `${sectionNoteCount === 1 ? "has a note" : "have notes"} on ${sectionNoteCount === 1 ? "it" : "them"}.`
      : null;

  await notify(address, `Changes requested: ${company}`, [
    `Hi ${firstNameOf(profile)},`,
    "",
    `${decidedBy} sent your proposal for ${company} back for changes.`,
    ...(where ? ["", where] : []),
    ...(note ? ["", `Their note: ${note}`] : []),
    "",
    // Rule 6: `changes_requested` is a resting state that returns to draft on
    // the first edit. Saying so prevents a salesperson wondering whether they
    // need to do something extra to reopen it.
    "Open it to see the notes in place on the sections they refer to.",
    "Editing anything returns it to draft:",
    "",
    proposalUrl(proposal),
  ]);
}
