"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
	generateOneSection,
	recordGenerationGaps,
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

export function GenerateButton({
	proposalId,
	blocking,
	warnings,
	hasContent,
	onProgress,
}: {
	proposalId: string;
	blocking: FieldGap[];
	warnings: FieldGap[];
	hasContent: boolean;
	onProgress?: (progress: SectionProgress) => void;
}) {
	const router = useRouter();
	const [, startTransition] = useTransition();
	const [running, setRunning] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [current, setCurrent] = useState<SectionKey | null>(null);
	const [failures, setFailures] = useState<string[]>([]);
	const [completed, setCompleted] = useState(0);

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

		for (const [index, section] of GENERATED_SECTIONS.entries()) {
			setCurrent(section.key);
			progress[section.key] = "writing";
			onProgress?.({ ...progress });

			const result = await generateOneSection(
				proposalId,
				section.key,
				confirmedWarnings,
			);

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
							? "Regenerate all sections"
							: "Generate proposal"}
				</button>

				{running && (
					<p className="text-sm text-ink-muted animate-fade">
						One call per section, in order — each one reads the sections before
						it.
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
