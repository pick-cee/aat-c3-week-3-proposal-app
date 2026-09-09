"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
	generateOneSection,
	recordGenerationGaps,
	type SectionWarning,
} from "@/app/actions/generate";
import { Icon, Note, buttonClass, cn } from "@/components/ui/primitives";
import {
	INTAKE_FIELD_LABELS,
	type FieldGap,
	type SectionKey,
} from "@/lib/db/types";
import { GENERATED_SECTIONS } from "@/lib/sections";

export type SectionProgress = Record<
	string,
	"pending" | "writing" | "done" | "failed"
>;

/**
 * Text that has arrived during this run, keyed by section.
 *
 * Held on the client so a finished section appears the instant its call
 * returns. The alternative — one `router.refresh()` after the whole loop —
 * left three completed sections showing "Not written yet" while the fourth was
 * still being written, which reads as the application having stalled.
 */
export type SectionResults = Record<
	string,
	{ content?: string; warnings?: SectionWarning[] }
>;

export function GenerateButton({
	proposalId,
	blocking,
	warnings,
	hasContent,
	onProgress,
	onResult,
	autoStart = false,
}: {
	proposalId: string;
	blocking: FieldGap[];
	warnings: FieldGap[];
	hasContent: boolean;
	onProgress?: (progress: SectionProgress) => void;
	/** Called the moment a section's text arrives, so its card can show it. */
	onResult?: (results: SectionResults) => void;
	/**
	 * Begin writing on arrival, without waiting for a click.
	 *
	 * Set when a salesperson lands here having just confirmed the intake and
	 * nothing has been written yet. They have already said "these values are
	 * right" — asking them to press a second button to make the thing they came
	 * for happen is a step that exists only because the code was built in that
	 * order.
	 */
	autoStart?: boolean;
}) {
	const router = useRouter();
	const [, startTransition] = useTransition();
	const [running, setRunning] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [current, setCurrent] = useState<SectionKey | null>(null);
	const [failures, setFailures] = useState<string[]>([]);
	const [completed, setCompleted] = useState(0);
	const started = useRef(false);

	const isBlocked = blocking.length > 0;
	const total = GENERATED_SECTIONS.length;

	async function run(confirmedWarnings: boolean) {
		setConfirming(false);
		setFailures([]);
		setCompleted(0);
		setRunning(true);

		const progress: SectionProgress = {};
		for (const section of GENERATED_SECTIONS) progress[section.key] = "pending";
		onProgress?.({ ...progress });

		try {
			await recordGenerationGaps(proposalId);
		} catch {
			// Non-fatal: the gap record is for the audit trail, not for generation.
		}

		const problems: string[] = [];
		const results: SectionResults = {};

		for (const [index, section] of GENERATED_SECTIONS.entries()) {
			setCurrent(section.key);
			progress[section.key] = "writing";
			onProgress?.({ ...progress });

			const result = await generateOneSection(
				proposalId,
				section.key,
				confirmedWarnings,
			);

			// Publish the text BEFORE anything else, so the card swaps from
			// skeleton to prose the moment the call returns rather than when the
			// whole run ends.
			if (result.ok && result.content) {
				results[section.key] = {
					content: result.content,
					warnings: result.warnings,
				};
				onResult?.({ ...results });
			}

			progress[section.key] = result.ok ? "done" : "failed";
			onProgress?.({ ...progress });
			setCompleted(index + 1);

			if (!result.ok && result.message) {
				problems.push(`${section.title}: ${result.message}`);
			}

			// A rate-limit stop applies to everything after it too — continuing
			// would burn three more failures against a limit already exhausted.
			if (result.stopRun) {
				for (const remaining of GENERATED_SECTIONS.slice(index + 1)) {
					progress[remaining.key] = "pending";
				}
				onProgress?.({ ...progress });
				break;
			}
		}

		setCurrent(null);
		setRunning(false);
		setFailures(problems);

		// Pull the saved content down from the server now the run is finished.
		startTransition(() => router.refresh());
	}

	/**
	 * Start writing on arrival when there is nothing yet.
	 *
	 * The ref, not state, is the guard: React invokes effects twice in
	 * development, and a second run here would spend four more Sonnet calls
	 * against the hourly limit for output nobody asked for.
	 *
	 * Warn-tier gaps still stop for confirmation — a proposal that will carry
	 * "[To be confirmed]" in front of a client is not something to start
	 * silently.
	 */
	useEffect(() => {
		if (!autoStart || started.current) return;
		if (isBlocked || hasContent || warnings.length > 0) return;

		started.current = true;
		void run(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoStart, isBlocked, hasContent, warnings.length]);

	// The blocked state is rendered by ProposalWorkspace, attached to the
	// control it blocks and carrying a link to the fix. Repeating it here would
	// put the same message on screen twice, which is what the page did before.
	if (isBlocked) return null;

	if (confirming) {
		return (
			<Note
				tone="warning"
				title={`${warnings
					.map((g) => INTAKE_FIELD_LABELS[g.field])
					.join(", ")} ${warnings.length === 1 ? "is" : "are"} missing`}
			>
				<p>
					The proposal will show{" "}
					<code className="rounded bg-state-review-fill px-1 py-0.5 font-mono text-xs">
						[To be confirmed]
					</code>{" "}
					in place of {warnings.length === 1 ? "it" : "them"}. Claude will not
					invent a value.
				</p>
				<div className="mt-3 flex gap-2">
					<button
						type="button"
						onClick={() => void run(true)}
						className={buttonClass("primary", "sm")}
					>
						Generate anyway
					</button>
					<button
						type="button"
						onClick={() => setConfirming(false)}
						className={buttonClass("secondary", "sm")}
					>
						Let me fill them in
					</button>
				</div>
			</Note>
		);
	}

	return (
		<div>
			<div className="flex flex-wrap items-center gap-3">
				<button
					type="button"
					onClick={() =>
						warnings.length > 0 ? setConfirming(true) : void run(false)
					}
					disabled={running}
					className={buttonClass("primary")}
				>
					<Icon
						name="sparkle"
						className={cn("h-4 w-4", running && "animate-spin")}
					/>
					{running
						? `Writing ${completed + (current ? 1 : 0)} of ${total}…`
						: hasContent
							? "Rewrite all sections"
							: "Write the proposal"}
				</button>

				{running && current && (
					<p className="text-sm text-ink-muted animate-fade">
						Writing{" "}
						<span className="font-medium text-ink">
							{GENERATED_SECTIONS.find((s) => s.key === current)?.title}
						</span>
						…
					</p>
				)}
			</div>

			{failures.length > 0 && (
				<div className="mt-3 space-y-2">
					{failures.map((message, i) => (
						<Note key={i} tone="danger">
							{message}
						</Note>
					))}
				</div>
			)}
		</div>
	);
}
