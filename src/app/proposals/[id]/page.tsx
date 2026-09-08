import Link from "next/link";
import { notFound } from "next/navigation";

import { loadDeliveries } from "@/app/actions/send";
import { AppShell } from "@/components/AppShell";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { IntakePanel } from "@/components/IntakePanel";
import { MaterialList } from "@/components/MaterialList";
import { MaterialUploader } from "@/components/MaterialUploader";
import { ProposalWorkspace } from "@/components/ProposalWorkspace";
import { SendPanel } from "@/components/SendPanel";
import { StatusPill } from "@/components/StatusPill";
import { WorkflowActions } from "@/components/WorkflowActions";
import { Icon, Note, buttonClass } from "@/components/ui/primitives";
import { requireProfile } from "@/lib/auth";
import { costOf } from "@/lib/constants";
import { getServerClient } from "@/lib/db/server";
import type {
  ActivityLogEntry,
  Proposal,
  ProposalSection,
  SupportingMaterial,
} from "@/lib/db/types";
import { resolveRecipient } from "@/lib/env";
import { assessReadiness } from "@/lib/policy/fields";

export default async function ProposalEditorPage({
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

  const [{ data: sectionRows }, { data: materialRows }, { data: activityRows }] =
    await Promise.all([
      db
        .from("proposal_sections")
        .select("*")
        .eq("proposal_id", id)
        .order("position", { ascending: true }),
      db
        .from("supporting_materials")
        .select("*")
        .eq("proposal_id", id)
        .order("created_at", { ascending: true }),
      db
        .from("activity_log")
        .select("*")
        .eq("proposal_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const sections = (sectionRows ?? []) as ProposalSection[];
  const materials = (materialRows ?? []) as SupportingMaterial[];
  const activity = (activityRows ?? []) as ActivityLogEntry[];

  const isAuthor = proposal.author_id === actor.id;
  const editable =
    isAuthor &&
    (proposal.status === "draft" || proposal.status === "changes_requested");
  const readiness = assessReadiness(proposal, true);

  const staleCount = sections.filter(
    (s) => (s.stale_fields ?? []).length > 0,
  ).length;
  const ungenerated = sections.filter(
    (s) => s.source === "generated" && !s.content,
  );

  const submitBlockedReason = !readiness.canGenerate
    ? readiness.reason
    : ungenerated.length > 0
      ? `${ungenerated.map((s) => s.title).join(", ")} ${
          ungenerated.length === 1 ? "has" : "have"
        } not been written yet.`
      : null;

  const deliveries =
    proposal.status === "approved" || proposal.status === "sent"
      ? await loadDeliveries(id)
      : [];

  const recipient = resolveRecipient(proposal.client_email?.trim() ?? "");

  const { data: latestApproval } =
    proposal.status === "changes_requested"
      ? await db
          .from("approvals")
          .select("*")
          .eq("proposal_id", id)
          .eq("decision", "changes_requested")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

  const spend = activity.reduce(
    (total, entry) =>
      total +
      costOf(entry.model_used ?? "", entry.input_tokens, entry.output_tokens),
    0,
  );

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
            {proposal.client_name ?? "No client name"}
            <span className="mx-1.5 text-ink-subtle">·</span>
            {proposal.author_name}
            {proposal.version > 1 && (
              <>
                <span className="mx-1.5 text-ink-subtle">·</span>
                <span className="tabular">version {proposal.version}</span>
              </>
            )}
          </p>
        </div>

        {actor.role === "approver" && proposal.status === "in_review" && !isAuthor && (
          <Link
            href={`/proposals/${id}/review`}
            className={buttonClass("primary")}
          >
            Review this proposal
          </Link>
        )}
      </header>

      {!isAuthor && (
        <Note tone="neutral" className="mt-5">
          You are viewing someone else&apos;s proposal. Only its author can edit
          it.
        </Note>
      )}

      {/* The rejection note. `changes_requested` is a resting state precisely
          so this survives until the salesperson acts on it. */}
      {latestApproval?.note && proposal.status === "changes_requested" && (
        <Note
          tone="warning"
          title={`${latestApproval.approver_name} asked for changes`}
          className="mt-5"
        >
          <p className="text-ink">{latestApproval.note}</p>
          <p className="mt-1.5 text-xs">
            Editing anything here returns this to draft.
          </p>
        </Note>
      )}

      {isAuthor && (
        <div className="mt-6">
          <WorkflowActions
            proposal={proposal}
            blockingReason={submitBlockedReason}
            staleCount={staleCount}
          />
        </div>
      )}

      {/* Sending belongs to the author. The approver's job ends at the
          decision — letting them also deliver hands one person the whole chain. */}
      {isAuthor &&
        (proposal.status === "approved" || proposal.status === "sent") && (
          <div className="mt-4">
            <SendPanel
              proposalId={id}
              intendedRecipient={recipient.intended || null}
              actualRecipient={recipient.actual}
              demoMode={recipient.demoMode}
              deliveries={deliveries}
            />
          </div>
        )}

      {/*
        Two columns. The document is the work, so it takes the width; the
        inputs that feed it stay visible beside it rather than sitting below
        the fold, where the thing that unblocks the page was the last thing
        anyone found.
      */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
        <ProposalWorkspace
          proposalId={id}
          sections={sections}
          editable={editable}
          blocking={readiness.blocking}
          warnings={readiness.warnings}
          spend={spend}
        />

        <aside className="space-y-4 lg:sticky lg:top-20">
          <IntakePanel proposal={proposal} editable={editable} />

          {(editable || materials.length > 0) && (
            <section className="card overflow-hidden">
              <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-ink">
                  Supporting materials
                </h2>
                <span className="text-2xs text-ink-subtle tabular">
                  {materials.filter((m) => m.summarized).length} used
                </span>
              </header>

              <div className="space-y-3 p-4">
                {materials.length > 0 && (
                  <MaterialList materials={materials} editable={editable} />
                )}
                {editable && <MaterialUploader proposalId={id} />}
              </div>
            </section>
          )}

          {/* Collapsed by default. The audit trail matters, but it is
              reference material — it should not push the intake off screen. */}
          <details className="card group overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">Activity</h2>
              <span className="flex items-center gap-1.5 text-2xs text-ink-subtle">
                <span className="tabular">{activity.length}</span>
                <Icon
                  name="arrow-left"
                  className="h-3 w-3 -rotate-90 transition-transform group-open:rotate-90"
                />
              </span>
            </summary>
            <div className="border-t border-line p-3">
              <ActivityTimeline entries={activity} />
            </div>
          </details>
        </aside>
      </div>
    </AppShell>
  );
}
