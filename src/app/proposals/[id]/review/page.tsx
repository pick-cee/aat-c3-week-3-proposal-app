import { notFound } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { ReviewControls } from "@/components/ReviewControls";
import { StatusPill } from "@/components/StatusPill";
import { Eyebrow, Icon, Note, cn } from "@/components/ui/primitives";
import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import {
	INTAKE_FIELD_KEYS,
	INTAKE_FIELD_LABELS,
	type Approval,
	type Proposal,
	type ProposalSection,
} from "@/lib/db/types";
import { stalenessMessage } from "@/lib/policy/staleness";

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

	const [{ data: sectionRows }, { data: approvalRows }] = await Promise.all([
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
	]);

	const sections = (sectionRows ?? []) as ProposalSection[];
	const approvals = (approvalRows ?? []) as Approval[];

	const isAuthor = proposal.author_id === actor.id;
	const canDecide =
		actor.role === "approver" && !isAuthor && proposal.status === "in_review";
	const staleCount = sections.filter(
		(s) => (s.stale_fields ?? []).length > 0,
	).length;

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

			<div className="mt-8 grid gap-8 lg:grid-cols-[1fr_21rem]">
				<div>
					<Eyebrow>The proposal as it would reach the client</Eyebrow>

					<div className="stagger mt-3 space-y-3">
						{sections.map((section) => {
							const stale = stalenessMessage(section.stale_fields ?? []);

							return (
								<article key={section.id} className="card overflow-hidden">
									<div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
										<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-sunken text-2xs font-semibold text-ink-subtle tabular">
											{section.position}
										</span>
										<h2 className="text-sm font-semibold text-ink">
											{section.title}
										</h2>
									</div>

									{/* The approver sees the same staleness markers the editor
                      shows. They are the person separation of duties exists to
                      protect — hiding from them that a section predates its own
                      inputs would defeat the point. */}
									{stale && (
										<Note
											tone="warning"
											className="rounded-none border-x-0 border-t-0"
										>
											<span className="flex items-start gap-1.5">
												<Icon
													name="alert"
													className="mt-0.5 h-3.5 w-3.5 shrink-0"
												/>
												<span>{stale}</span>
											</span>
										</Note>
									)}

									<div className="prose-proposal whitespace-pre-wrap px-4 py-4 text-sm text-ink-muted">
										{section.content ?? (
											<span className="italic text-ink-subtle">
												This section is empty.
											</span>
										)}
									</div>
								</article>
							);
						})}
					</div>
				</div>

				<aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
					{canDecide ? (
						<ReviewControls proposalId={id} staleCount={staleCount} />
					) : (
						<NoDecision
							isAuthor={isAuthor}
							isApprover={actor.role === "approver"}
							status={proposal.status}
						/>
					)}

					<section className="card p-5">
						<p className="font-medium text-ink">What was actually agreed</p>
						<p className="mt-1 text-xs text-ink-subtle">
							Straight from the salesperson&apos;s notes. Check the proposal
							against this.
						</p>

						<dl className="mt-4 space-y-3">
							{INTAKE_FIELD_KEYS.map((field) => (
								<div key={field}>
									<dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">
										{INTAKE_FIELD_LABELS[field]}
									</dt>
									<dd className="mt-0.5 text-sm text-ink">
										{proposal[field] ?? (
											<span className="italic text-ink-subtle">
												Not provided
											</span>
										)}
									</dd>
								</div>
							))}
						</dl>
					</section>

					{approvals.length > 0 && (
						<section className="card p-5">
							<p className="font-medium text-ink">Decision history</p>
							<ul className="mt-3 space-y-3">
								{approvals.map((approval) => (
									<li
										key={approval.id}
										className="border-l-2 border-line pl-3 text-sm"
									>
										<p>
											<span
												className={cn(
													"font-medium",
													approval.decision === "approved"
														? "text-state-approved"
														: "text-state-changes",
												)}
											>
												{approval.decision === "approved"
													? "Approved"
													: "Changes requested"}
											</span>
											<span className="text-ink-muted">
												{" "}
												by {approval.approver_name}
											</span>
										</p>
										<p className="text-2xs text-ink-subtle tabular">
											{new Date(approval.created_at).toLocaleString(undefined, {
												month: "short",
												day: "numeric",
												hour: "numeric",
												minute: "2-digit",
											})}
										</p>
										{approval.note && (
											<p className="mt-1 text-ink-muted">{approval.note}</p>
										)}
									</li>
								))}
							</ul>
						</section>
					)}
				</aside>
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
