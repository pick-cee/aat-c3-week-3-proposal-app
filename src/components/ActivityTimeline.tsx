import { Icon, cn } from "@/components/ui/primitives";
import type { ActivityEvent, ActivityLogEntry } from "@/lib/db/types";
import { formatDateTime, formatNumber } from "@/lib/format";

interface EventStyle {
	label: string;
	icon: Parameters<typeof Icon>[0]["name"];
	tone: string;
}

const EVENTS: Record<ActivityEvent, EventStyle> = {
	created: { label: "Created", icon: "plus", tone: "text-ink-subtle" },
	intake_extracted: {
		label: "Read the notes",
		icon: "sparkle",
		tone: "text-ink-muted",
	},
	intake_confirmed: {
		label: "Intake confirmed",
		icon: "check",
		tone: "text-state-approved",
	},
	generated: { label: "Generated", icon: "sparkle", tone: "text-ink-muted" },
	regenerated: {
		label: "Regenerated",
		icon: "refresh",
		tone: "text-ink-muted",
	},
	generation_rejected: {
		label: "Rejected",
		icon: "alert",
		tone: "text-state-changes",
	},
	generation_failed: {
		label: "Failed",
		icon: "alert",
		tone: "text-state-failed",
	},
	material_summarized: {
		label: "Summarized",
		icon: "file",
		tone: "text-ink-subtle",
	},
	// Covers both an intake change and a section edited by hand. The detail
	// says which, so a fixed label like "Intake edited" would be wrong half the
	// time; "Edited" is true of both and the detail carries the specifics.
	intake_edited: {
		label: "Edited",
		icon: "file",
		tone: "text-ink-subtle",
	},
	sections_marked_stale: {
		label: "Marked stale",
		icon: "clock",
		tone: "text-state-review",
	},
	submitted: { label: "Submitted", icon: "send", tone: "text-ink-muted" },
	approved: { label: "Approved", icon: "check", tone: "text-state-approved" },
	changes_requested: {
		label: "Changes requested",
		icon: "alert",
		tone: "text-state-changes",
	},
	version_forked: {
		label: "New version",
		icon: "file",
		tone: "text-ink-muted",
	},
	sent: { label: "Sent", icon: "send", tone: "text-state-sent" },
	send_failed: {
		label: "Send failed",
		icon: "alert",
		tone: "text-state-failed",
	},
	rate_limited: {
		label: "Rate limited",
		icon: "clock",
		tone: "text-state-review",
	},
};

export function ActivityTimeline({ entries }: { entries: ActivityLogEntry[] }) {
	if (entries.length === 0) {
		return (
			<p className="rounded border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-subtle">
				Nothing logged yet.
			</p>
		);
	}

	return (
		<ol className="card divide-y divide-line overflow-hidden">
			{entries.map((entry) => {
				const style = EVENTS[entry.event];
				const tokens = entry.input_tokens + entry.output_tokens;

				return (
					<li key={entry.id} className="flex gap-3 px-4 py-2.5">
						<span
							className={cn(
								"mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center",
								style.tone,
							)}
						>
							<Icon name={style.icon} className="h-3.5 w-3.5" />
						</span>

						<div className="min-w-0 flex-1">
							<p className="text-sm">
								<span className={cn("font-medium", style.tone)}>
									{style.label}
								</span>
								{entry.detail && (
									<span className="text-ink-muted"> — {entry.detail}</span>
								)}
							</p>

							<p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-ink-subtle">
								<span className="tabular">
									{formatDateTime(entry.created_at)}
								</span>
								{entry.actor_name && <span>{entry.actor_name}</span>}
								{tokens > 0 && (
									<span className="tabular">
										{formatNumber(tokens)} tokens
									</span>
								)}
								{entry.model_used && (
									<span className="font-mono">
										{entry.model_used.replace("claude-", "")}
									</span>
								)}
							</p>
						</div>
					</li>
				);
			})}
		</ol>
	);
}
