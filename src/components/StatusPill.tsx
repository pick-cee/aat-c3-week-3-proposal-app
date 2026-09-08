import type { ProposalStatus } from "@/lib/db/types";
import { cn } from "@/components/ui/primitives";

export type DisplayStatus = ProposalStatus | "send_failed";

interface StatusStyle {
	label: string;
	/** Chip background and text. */
	chip: string;
	/** The leading dot. */
	dot: string;
	/** Only failure and review earn attention-drawing treatment. */
	pulse?: boolean;
}

const STYLES: Record<DisplayStatus, StatusStyle> = {
	draft: {
		label: "Draft",
		chip: "bg-state-draft-fill text-state-draft",
		dot: "bg-state-draft",
	},
	in_review: {
		label: "In review",
		chip: "bg-state-review-fill text-[hsl(32_81%_29%)]",
		dot: "bg-state-review",
		pulse: true,
	},
	changes_requested: {
		label: "Changes requested",
		chip: "bg-state-changes-fill text-[hsl(21_90%_35%)]",
		dot: "bg-state-changes",
	},
	approved: {
		label: "Approved",
		chip: "bg-state-approved-fill text-[hsl(163_88%_20%)]",
		dot: "bg-state-approved",
	},
	sent: {
		label: "Sent",
		chip: "bg-state-sent-fill text-[hsl(201_90%_27%)]",
		dot: "bg-state-sent",
	},
	// The only status that gets red. An approved proposal that never reached the
	// client is the worst state this system can be in.
	send_failed: {
		label: "Send failed",
		chip: "bg-state-failed-fill text-[hsl(0_74%_35%)] ring-1 ring-inset ring-state-failed/20",
		dot: "bg-state-failed",
		pulse: true,
	},
};

export function StatusPill({
	status,
	size = "md",
	className,
}: {
	status: DisplayStatus;
	size?: "sm" | "md";
	className?: string;
}) {
	const style = STYLES[status];

	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium",
				size === "sm" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs",
				style.chip,
				className,
			)}
		>
			<span
				className={cn(
					"rounded-full",
					size === "sm" ? "h-1.5 w-1.5" : "h-1.5 w-1.5",
					style.dot,
					style.pulse && "animate-pulse-ring",
				)}
			/>
			{style.label}
		</span>
	);
}

/** The bare dot, for dense rows where the word would not fit. */
export function StatusDot({
	status,
	className,
}: {
	status: DisplayStatus;
	className?: string;
}) {
	const style = STYLES[status];

	return (
		<span
			className={cn("inline-block h-2 w-2 rounded-full", style.dot, className)}
			title={style.label}
		/>
	);
}

export function statusLabel(status: DisplayStatus): string {
	return STYLES[status].label;
}
