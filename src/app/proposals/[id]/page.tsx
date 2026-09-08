import Link from "next/link";
import { notFound } from "next/navigation";

import { loadDeliveries } from "@/app/actions/send";
import { updateIntake } from "@/app/actions/proposals";
import { AppShell } from "@/components/AppShell";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { IntakeForm } from "@/components/IntakeForm";
import { MaterialList } from "@/components/MaterialList";
import { MaterialUploader } from "@/components/MaterialUploader";
import { ProposalWorkspace } from "@/components/ProposalWorkspace";
import { SendPanel } from "@/components/SendPanel";
import { StatusPill } from "@/components/StatusPill";
import { WorkflowActions } from "@/components/WorkflowActions";
import { Eyebrow, Icon, Note, buttonClass } from "@/components/ui/primitives";
import { requireProfile } from "@/lib/auth";
import { costOf } from "@/lib/constants";
import { getServerClient } from "@/lib/db/server";
import {
  INTAKE_FIELD_KEYS,
  INTAKE_FIELD_LABELS,
  type ActivityLogEntry,
  type Proposal,
  type ProposalSection,
  type SupportingMaterial,
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

      <div className="mt-10">
        <ProposalWorkspace
          proposalId={id}
          sections={sections}
          editable={editable}
          blocking={readiness.blocking}
          warnings={readiness.warnings}
          spend={spend}
        />
      </div>

      {(editable || materials.length > 0) && (
        <section className="mt-10">
          <Eyebrow>Supporting materials</Eyebrow>
          {editable && (
            <div className="mt-3">
              <MaterialUploader proposalId={id} />
            </div>
          )}
          <div className="mt-4">
            <MaterialList materials={materials} editable={editable} />
          </div>
        </section>
      )}

      <section id="intake" className="mt-10 scroll-mt-20">
        <Eyebrow>What the salesperson recorded</Eyebrow>
        <p className="mt-1 text-sm text-ink-muted">
          These go into the document exactly as typed. Changing one marks any
          section written before the change.
        </p>

        <div className="mt-4">
          {editable ? (
            <IntakeForm
              action={updateIntake.bind(null, id)}
              initial={proposal}
              // Still shown here: knowing a value came from the notes rather
              // than someone's memory is worth as much when revising as it was
              // when confirming.
              provenance={proposal.field_provenance}
              submitLabel="Save intake"
            />
          ) : (
            <IntakeReadOnly proposal={proposal} />
          )}
        </div>
      </section>

      <section className="mt-10">
        <Eyebrow>Activity</Eyebrow>
        <div className="mt-3">
          <ActivityTimeline entries={activity} />
        </div>
      </section>
    </AppShell>
  );
}

function IntakeReadOnly({ proposal }: { proposal: Proposal }) {
  return (
    <dl className="card grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
      {INTAKE_FIELD_KEYS.map((field) => (
        <div key={field}>
          <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            {INTAKE_FIELD_LABELS[field]}
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {proposal[field] ?? (
              <span className="inline-flex items-center gap-1 italic text-ink-subtle">
                <Icon name="alert" className="h-3 w-3" />
                Not provided
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
