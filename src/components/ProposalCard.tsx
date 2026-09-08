import Link from "next/link";

import { StatusPill } from "@/components/StatusPill";
import { Icon, Meter, cn } from "@/components/ui/primitives";
import type { Profile } from "@/lib/db/types";
import { describeAge, type QueueItem } from "@/lib/queue-logic";

export function ProposalCard({
	item,
	actor,
}: {
	item: QueueItem;
	actor: Profile;
}) {
	const { proposal, displayStatus, failure, isStale, needsMe } = item;
	const isFailed = displayStatus === "send_failed";

	// An approver with a decision to make lands on the review screen, not the
	// editor they cannot use.
	const href =
		actor.role === "approver" &&
		proposal.status === "in_review" &&
		proposal.author_id !== actor.id
			? `/proposals/${proposal.id}/review`
			: `/proposals/${proposal.id}`;

	return (
		<Link
			href={href}
			className={cn(
				"card-interactive group relative block overflow-hidden p-4",
				isFailed && "border-state-failed/30 bg-state-failed-fill/30",
			)}
		>
			{/*
        A colour bar rather than a whole tinted card: it marks urgency at the
        edge of vision without making the text harder to read.
      */}
			{(isFailed || needsMe) && (
				<span
					className={cn(
						"absolute inset-y-0 left-0 w-[3px]",
						isFailed ? "bg-state-failed" : "bg-accent",
					)}
				/>
			)}

			<div className="flex items-start justify-between gap-4 pl-1.5">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h3 className="truncate font-semibold text-ink">
							{proposal.company_name ?? "Untitled proposal"}
						</h3>
						{proposal.version > 1 && (
							<span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-2xs font-medium text-ink-subtle tabular">
								v{proposal.version}
							</span>
						)}
					</div>

					<p className="mt-0.5 truncate text-sm text-ink-muted">
						{proposal.client_name ?? "No client name"}
						<span className="mx-1.5 text-ink-subtle">·</span>
						{proposal.author_name}
					</p>
				</div>

				<StatusPill status={displayStatus} size="sm" />
			</div>

			<div className="mt-3.5 flex items-center gap-3 pl-1.5">
				<Meter
					value={item.sectionsWritten}
					max={item.sectionsTotal}
					tone={
						isFailed
							? "danger"
							: item.sectionsWritten === item.sectionsTotal
								? "positive"
								: "neutral"
					}
					className="max-w-[7rem]"
				/>
				<span className="shrink-0 text-2xs text-ink-subtle tabular">
					{item.sectionsWritten}/{item.sectionsTotal} written
				</span>

				<span className="ml-auto flex shrink-0 items-center gap-1 text-2xs text-ink-subtle">
					<Icon name="clock" className="h-3 w-3" />
					<span className="tabular">{describeAge(item.ageHours)}</span>
				</span>
			</div>

			{/* Staleness is a property of the whole proposal here — it has been
          sitting in review too long, which is a different thing from a stale
          section. Different words, deliberately. */}
			{isStale && !isFailed && (
				<p className="mt-3 flex items-center gap-1.5 rounded bg-state-review-fill px-2.5 py-1.5 text-xs text-[hsl(32_81%_29%)]">
					<Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
					Waiting {describeAge(item.ageHours)} for a decision
				</p>
			)}

			{/* The plain-language cause, never a status code. */}
			{isFailed && failure?.failure_reason && (
				<p className="mt-3 flex items-start gap-1.5 rounded bg-surface px-2.5 py-2 text-xs text-[hsl(0_74%_35%)]">
					<Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
					<span>{failure.failure_reason}</span>
				</p>
			)}
		</Link>
	);
}
