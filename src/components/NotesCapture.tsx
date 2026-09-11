"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { discardIfEmpty, extractFromNotes } from "@/app/actions/extract";
import { deleteDraft } from "@/app/actions/proposals";
import { MaterialList } from "@/components/MaterialList";
import { MaterialUploader } from "@/components/MaterialUploader";
import { Icon, Note, buttonClass, cn } from "@/components/ui/primitives";
import { INTAKE_FIELD_LABELS, type SupportingMaterial } from "@/lib/db/types";
import { useDraftGuard } from "@/lib/use-draft-guard";

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
	const [kept, setKept] = useState<string | null>(null);

	// Discarding is a deliberate exit, so the guard must be off while it runs —
	// otherwise the click handler asks "are you sure you want to leave?" about a
	// draft the salesperson has just chosen to throw away.
	const [discarding, setDiscarding] = useState(false);
	const [confirmingDiscard, setConfirmingDiscard] = useState(false);

	// The notes exist nowhere but this textarea until extraction runs.
	useDraftGuard(
		!discarding &&
			notes.trim() !== initialNotes.trim() &&
			notes.trim().length > 0,
		"Your notes have not been read yet. Leaving now loses what you have typed.",
	);

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

	/**
	 * Backing out of a proposal that was started by mistake.
	 *
	 * The row was created the moment "New proposal" was clicked, because
	 * uploads need something to attach to. Without this, the only way off this
	 * screen is the nav, and the empty draft stays on the queue forever.
	 *
	 * Two paths, because "discard" means different things depending on whether
	 * anything is here yet:
	 *
	 *   Nothing typed — `discardIfEmpty` removes the row with no ceremony. There
	 *   is nothing to lose and a confirmation would be noise.
	 *
	 *   Something typed — asking first, then deleting for real. This previously
	 *   called `discardIfEmpty` unconditionally, which REFUSES once there is
	 *   content and reported that it had been kept. Technically honest, but the
	 *   salesperson pressed a button labelled Discard and the draft was still
	 *   there: a control that declines to do the thing it is named after reads
	 *   as broken.
	 */
	function discard() {
		setError(null);
		setKept(null);

		// Anything worth confirming about? Uploaded files count: they are work.
		const hasWork = notes.trim().length > 0 || materials.length > 0;

		if (hasWork && !confirmingDiscard) {
			setConfirmingDiscard(true);
			return;
		}

		setDiscarding(true);

		startTransition(async () => {
			try {
				if (hasWork) {
					// Deliberate and destructive — the user has just confirmed it.
					await deleteDraft(proposalId);
					return; // deleteDraft redirects
				}

				const result = await discardIfEmpty(proposalId);
				if (result.discarded) {
					router.push("/queue");
					return;
				}

				setDiscarding(false);
				setConfirmingDiscard(false);
				setKept(result.reason ?? "It was kept.");
			} catch (e) {
				// A redirect throws by design; anything else is a real failure.
				if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e;
				setDiscarding(false);
				setConfirmingDiscard(false);
				setError(e instanceof Error ? e.message : String(e));
			}
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

			{kept && (
				<Note tone="neutral" title="This draft was kept">
					{kept}
					<p className="mt-2 text-ink-muted">
						Nothing you have typed or uploaded is ever thrown away
						automatically. You can carry on from here.
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
					{/* `pending` is shared with the delete transition, so it must be
					    narrowed here — otherwise deleting a draft makes this button
					    claim it is reading the notes. */}
					{pending && !discarding ? "Reading your notes…" : "Read my notes"}
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

				{/*
          Pushed to the far end: backing out is a real need, but it is not
          what this screen is for.

          Once there is work here, the first click asks rather than acts — and
          says what will be lost, which a generic confirm dialogue cannot.
        */}
				{confirmingDiscard ? (
					<span className="ms-auto flex flex-wrap items-center gap-2">
						<span className="text-sm text-ink">
							Delete this draft
							{materials.length > 0 && (
								<>
									{" "}
									and {materials.length} uploaded file
									{materials.length === 1 ? "" : "s"}
								</>
							)}
							? This cannot be undone.
						</span>
						<button
							type="button"
							onClick={discard}
							disabled={pending}
							className={buttonClass("danger", "sm")}
						>
							{discarding ? "Deleting…" : "Yes, delete it"}
						</button>
						<button
							type="button"
							onClick={() => setConfirmingDiscard(false)}
							disabled={pending}
							className={buttonClass("secondary", "sm")}
						>
							Keep it
						</button>
					</span>
				) : (
					<button
						type="button"
						onClick={discard}
						disabled={pending}
						className={cn(buttonClass("ghost"), "ms-auto")}
					>
						Discard this draft
					</button>
				)}
			</div>
		</div>
	);
}
