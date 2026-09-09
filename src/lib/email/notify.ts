import "server-only";

import { Resend } from "resend";

import { getAdminClient } from "@/lib/db/admin";
import type { Profile, Proposal } from "@/lib/db/types";
import { env, resolveRecipient } from "@/lib/env";

/**
 * Telling the approver a proposal is waiting.
 *
 * Without this, submitting sets a status and redirects, and the approver finds
 * out by happening to open the queue. `STALE_IN_REVIEW_HOURS` surfaces a
 * forgotten proposal after two days — on the queue, to the person who is not
 * looking at it. Meanwhile the salesperson is blocked and does not know why.
 *
 * Internal mail, but it goes through the same demo redirect as everything
 * else: a demo application must not be able to email a stranger, and an
 * approver address in a seeded database is exactly the kind of address that
 * could belong to someone real.
 */
export async function notifyApprovers(
  proposal: Proposal,
  submittedBy: string,
): Promise<void> {
  // The service role, deliberately: a salesperson has no RLS visibility of
  // other people's profiles, and finding out who the approvers are is a
  // legitimate thing for the system to do on their behalf.
  const db = getAdminClient();

  const { data: approvers } = await db
    .from("profiles")
    .select("*")
    .eq("role", "approver");

  const recipients = (approvers ?? []) as Profile[];
  if (recipients.length === 0) return;

  // A profile has no email — that lives on auth.users — so resolve it there.
  const { data: users } = await db.auth.admin.listUsers();
  const emailById = new Map(
    (users?.users ?? []).map((u) => [u.id, u.email]),
  );

  const resend = new Resend(env.RESEND_API_KEY);
  const url = `${env.NEXT_PUBLIC_SITE_URL}/proposals/${proposal.id}/review`;

  for (const approver of recipients) {
    const address = emailById.get(approver.id);
    if (!address) continue;

    // The author cannot approve their own work, so telling them it is waiting
    // for them would be worse than silence.
    if (approver.id === proposal.author_id) continue;

    const { actual } = resolveRecipient(address);

    await resend.emails.send({
      from: env.RESEND_FROM_ADDRESS,
      to: actual,
      subject: `Ready for your review: ${proposal.company_name ?? "a proposal"}`,
      text: [
        `Hi ${approver.full_name.split(" ")[0]},`,
        "",
        `${submittedBy} has submitted a proposal for ${
          proposal.company_name ?? "a client"
        } and it is waiting on your review.`,
        "",
        url,
        "",
        "You can approve it, or send it back with notes on the sections that",
        "need work. Nothing reaches the client until you decide.",
      ].join("\n"),
    });
  }
}
