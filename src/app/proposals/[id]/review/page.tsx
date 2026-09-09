import { notFound } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { ReviewReference } from "@/components/ReviewReference";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import { StatusPill } from "@/components/StatusPill";
import { Icon, Note } from "@/components/ui/primitives";
import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import type {
  Approval,
  ApprovalComment,
  Proposal,
  ProposalSection,
  SupportingMaterial,
} from "@/lib/db/types";
import { placeholderWarning } from "@/lib/policy/placeholders";

/**
 * The review screen.
 *
 * Read-only on the document, with everything the approver needs to check it
 * against alongside. If the viewer is the author, the controls are replaced by
 * an explanation — approval by the author is not a control, it only looks like
 * one.
 */
export default async function ReviewPage({
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

  const [{ data: sectionRows }, { data: approvalRows }, { data: materialRows }] =
    await Promise.all([
      db
        .from("proposal_sections")
        .select("*")
        .eq("proposal_id", id)
        .order("position", { ascending: true }),
      db
        .from("approvals")
        .select("*")
        .eq("proposal_id", id)
        .order("created_at", { ascending: false }),
      // Newest first — the most recently added evidence is what an approver
      // has not seen before.
      db
        .from("supporting_materials")
        .select("*")
        .eq("proposal_id", id)
        .order("created_at", { ascending: false }),
    ]);

  const sections = (sectionRows ?? []) as ProposalSection[];
  const approvals = (approvalRows ?? []) as Approval[];
  const materials = (materialRows ?? []) as SupportingMaterial[];

  // Per-section notes from earlier rounds, so a reviewer sees what was already
  // raised rather than repeating it.
  const { data: commentRows } =
    approvals.length > 0
      ? await db
          .from("approval_comments")
          .select("*")
          .in(
            "approval_id",
            approvals.map((a) => a.id),
          )
      : { data: [] };

  const comments = (commentRows ?? []) as ApprovalComment[];

  const isAuthor = proposal.author_id === actor.id;
  const canDecide =
    actor.role === "approver" && !isAuthor && proposal.status === "in_review";

  const staleCount = sections.filter(
    (s) => (s.stale_fields ?? []).length > 0,
  ).length;

  // The approver is the last person who can catch this before a client does.
  const placeholders = placeholderWarning(sections);

  return (
    <AppShell actor={actor} backTo="/queue">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">
              {proposal.company_name ?? "Untitled proposal"}
            </h1>
            <StatusPill status={proposal.status} />
          </div>
          <p className="mt-1.5 text-ink-muted">
            {proposal.client_name}
            <span className="mx-1.5 text-ink-subtle">·</span>
            written by {proposal.author_name}
            {proposal.version > 1 && (
              <>
                <span className="mx-1.5 text-ink-subtle">·</span>
                <span className="tabular">version {proposal.version}</span>
              </>
            )}
          </p>
        </div>
      </header>

      {!canDecide && (
        <div className="mt-5">
          <NoDecision
            isAuthor={isAuthor}
            isApprover={actor.role === "approver"}
            status={proposal.status}
          />
        </div>
      )}

      {placeholders && (
        <Note tone="warning" title="This is not finished" className="mt-5">
          <p className="text-ink">{placeholders}</p>
          <p className="mt-1.5 text-xs">
            Approving it as it stands means approving the placeholder.
          </p>
        </Note>
      )}

      {canDecide && staleCount > 0 && (
        <Note tone="warning" className="mt-5">
          <span className="flex items-start gap-1.5">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {staleCount} section{staleCount === 1 ? "" : "s"}{" "}
              {staleCount === 1 ? "was" : "were"} written before the intake last
              changed. Each is marked below — worth checking they still match
              what was agreed.
            </span>
          </span>
        </Note>
      )}

      <div className="mt-7">
        <ReviewWorkspace
          proposalId={id}
          sections={sections}
          canDecide={canDecide}
        />
      </div>

      <div className="mt-6">
        <ReviewReference
          proposal={proposal}
          materials={materials}
          approvals={approvals}
          comments={comments}
          sections={sections}
        />
      </div>
    </AppShell>
  );
}

/** Why this viewer has no decision to make. */
function NoDecision({
  isAuthor,
  isApprover,
  status,
}: {
  isAuthor: boolean;
  isApprover: boolean;
  status: Proposal["status"];
}) {
  let message: string;

  if (isAuthor) {
    // The rule stated as a reason rather than a refusal — someone who
    // understands why will not go looking for a way around it.
    message =
      "You wrote this proposal, so you cannot approve it. Approval by the " +
      "author is not a control — it only looks like one. Someone else has to " +
      "review this before it can go to the client.";
  } else if (!isApprover) {
    message = "Only an approver can make a decision on this proposal.";
  } else if (status === "draft") {
    message = "This proposal has not been submitted for review yet.";
  } else if (status === "changes_requested") {
    message =
      "Changes have already been requested. It is back with the salesperson.";
  } else if (status === "approved" || status === "sent") {
    message = "This proposal has already been approved.";
  } else {
    message = "There is no decision to make on this proposal right now.";
  }

  return (
    <div className="card p-5">
      <div className="flex gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-subtle">
          <Icon name="lock" className="h-4 w-4" />
        </span>
        <div>
          <p className="font-medium text-ink">No decision to make</p>
          <p className="mt-1 text-sm text-ink-muted">{message}</p>
        </div>
      </div>
    </div>
  );
}
