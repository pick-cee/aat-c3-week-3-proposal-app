import Link from "next/link";
import { redirect } from "next/navigation";

import { startFromNotes } from "@/app/actions/extract";
import { AppShell } from "@/components/AppShell";
import { Icon, buttonClass } from "@/components/ui/primitives";
import { requireProfile } from "@/lib/auth";

/**
 * Starting a proposal.
 *
 * Creates the empty draft and sends the salesperson to the notes screen.
 * A draft has to exist first because supporting materials are keyed by
 * `proposal_id` — which is also why uploads were previously unreachable from
 * this screen at all.
 */
export default async function NewProposalPage() {
  const actor = await requireProfile();

  if (actor.role === "approver") {
    return (
      <AppShell actor={actor} backTo="/queue">
        <div className="mx-auto max-w-lg py-16 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-ink-subtle">
            <Icon name="lock" className="h-5 w-5" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">
            Approvers do not write proposals
          </h1>
          <p className="mt-2 text-ink-muted">
            Separation of duties means the person who reviews a proposal is not
            the person who wrote it. Your queue shows what is waiting for you.
          </p>
          <Link href="/queue" className={buttonClass("primary", "md", "mt-6")}>
            Go to the review queue
          </Link>
        </div>
      </AppShell>
    );
  }

  const proposalId = await startFromNotes();
  redirect(`/proposals/${proposalId}/notes`);
}
