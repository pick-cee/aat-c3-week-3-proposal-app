"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { extractFromNotes } from "@/app/actions/extract";
import { MaterialList } from "@/components/MaterialList";
import { MaterialUploader } from "@/components/MaterialUploader";
import { Icon, Note, buttonClass, cn } from "@/components/ui/primitives";
import { INTAKE_FIELD_LABELS, type SupportingMaterial } from "@/lib/db/types";

export function NotesCapture({
	proposalId,
	materials,
	initialNotes,
}: {
	proposalId: string;
	materials: SupportingMaterial[];
	initialNotes: string;
}) {
	const router = useRouter();
	const [notes, setNotes] = useState(initialNotes);
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [dropped, setDropped] = useState<
		Array<{ field: string; reason: string }>
	>([]);

	const usableMaterials = materials.filter((m) => m.summarized).length;
	const canExtract = notes.trim().length > 40 || usableMaterials > 0;

	function extract() {
		setError(null);
		setDropped([]);

		startTransition(async () => {
			const result = await extractFromNotes(proposalId, notes);

			if (!result.ok) {
				setError(result.message ?? "Extraction failed.");
				return;
			}

			if (result.dropped?.length) setDropped(result.dropped);
			router.push(`/proposals/${proposalId}/confirm`);
		});
	}

	return (
		<div className="space-y-6">
			<section>
				<label htmlFor="notes" className="text-sm font-medium text-ink">
					Discovery-call notes
				</label>
				<p className="mt-0.5 text-xs text-ink-subtle">
					Paste them as they are — fragments, half sentences, whatever you typed
					during the call. Claude reads them and fills in the form for you to
					check.
				</p>

				<textarea
					id="notes"
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					rows={14}
					disabled={pending}
					placeholder={
						"Call with Dana Whitfield, ops director at Northwind Logistics.\n" +
						"dana@northwind.example\n\n" +
						"12 depots, dispatch coordinated by spreadsheet. Costs about a day\n" +
						"a week of someone's time and they miss slots.\n\n" +
						"Want a scheduling tool. Discovery, build, two weeks hypercare.\n" +
						"We landed on £48,000, ten weeks from kickoff."
					}
					className="mt-2.5 block w-full rounded border border-line-strong bg-surface px-3.5 py-3 font-mono text-sm leading-relaxed text-ink shadow-sm transition-colors placeholder:text-ink-subtle/70 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10 disabled:opacity-60"
				/>
			</section>

			<section>
				<p className="text-sm font-medium text-ink">Supporting materials</p>
				<p className="mt-0.5 text-xs text-ink-subtle">
					A brief, a requirements doc, a spreadsheet of their numbers. Claude
					reads these too, and cites them when it fills in the form.
				</p>

				<div className="mt-2.5">
					<MaterialUploader proposalId={proposalId} />
				</div>

				{materials.length > 0 && (
					<div className="mt-3">
						<MaterialList materials={materials} editable />
					</div>
				)}
			</section>

			{error && (
				<Note tone="danger" title="Extraction did not run">
					{error}
					<p className="mt-2 text-ink-muted">
						Your notes are saved. You can try again, or fill the form in
						yourself.
					</p>
				</Note>
			)}

			{dropped.length > 0 && (
				<Note tone="warning" title="Some proposed values were discarded">
					<ul className="mt-1 space-y-0.5">
						{dropped.map((d) => (
							<li key={d.field}>
								<span className="font-medium text-ink">
									{INTAKE_FIELD_LABELS[
										d.field as keyof typeof INTAKE_FIELD_LABELS
									] ?? d.field}
								</span>{" "}
								— {d.reason}
							</li>
						))}
					</ul>
					<p className="mt-2">
						A value we cannot trace back to something you actually wrote is a
						guess, so it was dropped rather than shown to you.
					</p>
				</Note>
			)}

			<div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
				<button
					type="button"
					onClick={extract}
					disabled={pending || !canExtract}
					className={buttonClass("primary")}
				>
					<Icon
						name="sparkle"
						className={cn("h-4 w-4", pending && "animate-spin")}
					/>
					{pending ? "Reading your notes…" : "Read my notes"}
				</button>

				{/*
          Manual entry is a first-class path, not a fallback. A salesperson
          arriving with a clean brief should not be walked through a stage they
          do not need.
        */}
				<a
					href={`/proposals/${proposalId}/confirm?manual=1`}
					className={buttonClass("secondary")}
				>
					Skip — I&apos;ll fill it in myself
				</a>

				{!canExtract && (
					<p className="text-sm text-ink-subtle">
						Add some notes or upload a file first.
					</p>
				)}
			</div>
		</div>
	);
}
