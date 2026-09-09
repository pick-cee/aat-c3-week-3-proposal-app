import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { ProposalCard } from "@/components/ProposalCard";
import {
	EmptyState,
	Eyebrow,
	Icon,
	buttonClass,
	cn,
} from "@/components/ui/primitives";
import { requireProfile } from "@/lib/auth";
import { loadQueue, queueHeadline, type QueueItem } from "@/lib/queue";

export default async function QueuePage() {
	const actor = await requireProfile();
	const items = await loadQueue(actor);
	const headline = queueHeadline(items, actor);

	const failed = items.filter((i) => i.displayStatus === "send_failed");
	const needsMe = items.filter(
		(i) => i.needsMe && i.displayStatus !== "send_failed",
	);
	const rest = items.filter(
		(i) => !i.needsMe && i.displayStatus !== "send_failed",
	);

	return (
		<AppShell actor={actor}>
			{/*
        The first thing on screen is not a table. It is a sentence stating what
        needs this person — DESIGN.md section 9.
      */}
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<Eyebrow>{greeting()}</Eyebrow>
					<h1 className="mt-1.5 max-w-xl text-3xl font-semibold tracking-tight text-ink">
						{headline}
					</h1>
				</div>

				{actor.role === "salesperson" && (
					<Link href="/proposals/new" className={buttonClass("primary")}>
						<Icon name="plus" className="h-4 w-4" />
						New proposal
					</Link>
				)}
			</div>

			{items.length > 0 && (
				<div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<Stat label="Total" value={items.length} tone="neutral" />
					<Stat
						label={actor.role === "approver" ? "To review" : "Need you"}
						value={needsMe.length}
						tone={needsMe.length > 0 ? "accent" : "neutral"}
					/>
					<Stat
						label="Sent"
						value={items.filter((i) => i.displayStatus === "sent").length}
						tone="positive"
					/>
					<Stat
						label="Failed sends"
						value={failed.length}
						tone={failed.length > 0 ? "danger" : "neutral"}
					/>
				</div>
			)}

			{items.length === 0 ? (
				<div className="mt-8">
					<EmptyState
						icon={<Icon name="file" className="h-8 w-8" />}
						title={
							actor.role === "approver"
								? "Nothing has been submitted yet"
								: "No proposals yet"
						}
						description={
							actor.role === "approver"
								? "When a salesperson submits a proposal for review, it will appear here."
								: "Start from your discovery-call notes and Claude will write the first draft."
						}
						action={
							actor.role === "salesperson" && (
								<Link href="/proposals/new" className={buttonClass("primary")}>
									<Icon name="plus" className="h-4 w-4" />
									New proposal
								</Link>
							)
						}
					/>
				</div>
			) : (
				<div className="mt-8 space-y-8">
					{/* Failed sends get their own band, above everything, regardless of
              age. A salesperson opening the app sees this before anything they
              were planning to do. */}
					{failed.length > 0 && (
						<Band
							label="Never reached the client"
							tone="danger"
							count={failed.length}
							items={failed}
							actor={actor}
						/>
					)}

					{needsMe.length > 0 && (
						<Band
							label={actor.role === "approver" ? "Waiting on you" : "Your turn"}
							tone="accent"
							count={needsMe.length}
							items={needsMe}
							actor={actor}
						/>
					)}

					{rest.length > 0 && (
						<Band
							label="Everything else"
							tone="neutral"
							count={rest.length}
							items={rest}
							actor={actor}
						/>
					)}
				</div>
			)}
		</AppShell>
	);
}

function Band({
	label,
	tone,
	count,
	items,
	actor,
}: {
	label: string;
	tone: "danger" | "accent" | "neutral";
	count: number;
	items: QueueItem[];
	actor: Parameters<typeof ProposalCard>[0]["actor"];
}) {
	const tones = {
		danger: "text-state-failed",
		accent: "text-ink",
		neutral: "text-ink-subtle",
	};

	return (
		<section>
			<div className="flex items-center gap-2">
				<Eyebrow className={tones[tone]}>{label}</Eyebrow>
				<span className="rounded-full bg-surface-sunken px-1.5 text-2xs font-semibold text-ink-subtle tabular">
					{count}
				</span>
			</div>

			<div className="stagger mt-3 space-y-2.5">
				{items.map((item) => (
					<ProposalCard key={item.proposal.id} item={item} actor={actor} />
				))}
			</div>
		</section>
	);
}

/**
 * A stat tile. Four numbers a founder can read at a glance beat a paragraph
 * describing the same thing.
 */
function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: number;
	tone: "neutral" | "accent" | "positive" | "danger";
}) {
	const tones = {
		neutral: "text-ink",
		accent: "text-ink",
		positive: "text-state-approved",
		danger: value > 0 ? "text-state-failed" : "text-ink-subtle",
	};

	return (
		<div
			className={cn(
				"card px-4 py-3",
				tone === "danger" && value > 0 && "border-state-failed/25",
			)}
		>
			<p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">
				{label}
			</p>
			<p className={cn("mt-1 text-2xl font-semibold tabular", tones[tone])}>
				{value}
			</p>
		</div>
	);
}

function greeting(): string {
	const hour = new Date().getHours();
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}
