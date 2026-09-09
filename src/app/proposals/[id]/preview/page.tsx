import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientDocument } from "@/components/ClientDocument";
import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import type { Proposal, ProposalSection } from "@/lib/db/types";

/**
 * The proposal as the client will see it, before it is sent.
 *
 * Deliberately NOT the public `/p/[token]` route. That one reads through
 * `get_shared_proposal`, which returns only versions with a successful
 * delivery — so linking a salesperson there before sending would show them a
 * 404. The restriction is right (a token must never expose an unsent draft);
 * the preview simply needs a different door.
 *
 * This route is authenticated and scoped to the proposal's own people, and it
 * renders the SAME component as the public page so that what is previewed is
 * what is sent rather than an approximation of it.
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireProfile();
  const db = await getServerClient();

  const { data: proposalRow } = await db
    .from("proposals")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!proposalRow) notFound();
  const proposal = proposalRow as Proposal;

  // RLS already limits what this query can return; this is the readable
  // version of the same rule.
  const isAuthor = proposal.author_id === actor.id;
  if (!isAuthor && actor.role !== "approver") notFound();

  const { data: sectionRows } = await db
    .from("proposal_sections")
    .select("*")
    .eq("proposal_id", id)
    .order("position", { ascending: true });

  const sections = (sectionRows ?? []) as ProposalSection[];

  return (
    <div className="min-h-screen bg-surface">
      {/* A bar that cannot be mistaken for part of the document. */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface-sunken/90 backdrop-blur">
        <div className="mx-auto flex max-w-prose items-center justify-between gap-4 px-6 py-2.5">
          <p className="text-xs text-ink-muted">
            Preview — this is what the client sees. Nothing here is sent.
          </p>
          <Link
            href={`/proposals/${id}`}
            className="shrink-0 text-xs font-medium text-ink underline-offset-2 hover:underline"
          >
            Back to editing
          </Link>
        </div>
      </div>

      <ClientDocument
        clientName={proposal.client_name}
        companyName={proposal.company_name}
        salespersonName={proposal.salesperson_name ?? proposal.author_name}
        dateOfCall={proposal.date_of_call}
        version={proposal.version}
        isSuperseded={false}
        firstSentAt={null}
        updatedAt={proposal.updated_at}
        sections={sections.map((s) => ({
          title: s.title,
          content: s.content,
          position: s.position,
        }))}
      />
    </div>
  );
}
