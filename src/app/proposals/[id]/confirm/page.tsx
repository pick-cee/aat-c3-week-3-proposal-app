import Link from "next/link";
import { notFound } from "next/navigation";

import { confirmIntake } from "@/app/actions/proposals";
import { AppShell } from "@/components/AppShell";
import { IntakeForm } from "@/components/IntakeForm";
import { Icon, Note, cn } from "@/components/ui/primitives";
import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import { INTAKE_FIELD_KEYS, type Proposal } from "@/lib/db/types";

export default async function ConfirmPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ manual?: string }>;
}) {
	const { id } = await params;
	const { manual } = await searchParams;
	const actor = await requireProfile();
	const db = await getServerClient();

	const { data: proposalRow } = await db
		.from("proposals")
		.select("*")
		.eq("id", id)
		.maybeSingle();

	if (!proposalRow) notFound();
	const proposal = proposalRow as Proposal;

	if (proposal.author_id !== actor.id) notFound();

	const provenance = proposal.field_provenance ?? {};
	const extractedCount = Object.keys(provenance).length;
	const wasExtracted = extractedCount > 0 && manual !== "1";

	const missing = INTAKE_FIELD_KEYS.filter(
		(field) => !(proposal[field] ?? "").toString().trim(),
	).length;

	return (
		<AppShell actor={actor} backTo={`/proposals/${id}/notes`} backLabel="Notes">
			<div className="max-w-3xl">
				<h1 className="text-3xl font-semibold tracking-tight text-ink">
					{wasExtracted ? "Check what Claude found" : "Fill in the details"}
				</h1>
				<p className="mt-2 max-w-xl text-ink-muted">
					{wasExtracted ? (
						<>
							Every value below is quoted from your notes — nothing was
							inferred. Correct anything that is wrong, fill in what is missing,
							and confirm.
						</>
					) : (
						<>
							These values go into the document exactly as typed. Claude is told
							they are fixed and never rewrites them.
						</>
					)}
				</p>

				{wasExtracted && (
					<div className="mt-6 flex flex-wrap gap-3">
						<Stat
							icon="check"
							tone="positive"
							value={extractedCount}
							label={`field${extractedCount === 1 ? "" : "s"} found in your notes`}
						/>
						{missing > 0 && (
							<Stat
								icon="alert"
								tone="neutral"
								value={missing}
								label={`still empty — your notes did not cover ${missing === 1 ? "it" : "them"}`}
							/>
						)}
					</div>
				)}

				{wasExtracted && (
					<Note tone="info" className="mt-5">
						<span className="flex items-start gap-2">
							<Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>
								Nothing is fixed until you confirm. Every price and date in the
								finished proposal will be one you accepted here — Claude never
								writes a commercial term of its own.
							</span>
						</span>
					</Note>
				)}

				{!wasExtracted && proposal.raw_notes && (
					<p className="mt-5 text-sm text-ink-muted">
						Filling this in by hand.{" "}
						<Link
							href={`/proposals/${id}/notes`}
							className="font-medium text-ink underline underline-offset-2"
						>
							Go back to your notes
						</Link>{" "}
						if you would rather Claude read them.
					</p>
				)}

				<div className="mt-7">
					<IntakeForm
						action={confirmIntake.bind(null, id)}
						initial={proposal}
						provenance={wasExtracted ? provenance : undefined}
						submitLabel={
							wasExtracted ? "Confirm and continue" : "Save and continue"
						}
					/>
				</div>
			</div>
		</AppShell>
	);
}

function Stat({
	icon,
	tone,
	value,
	label,
}: {
	icon: Parameters<typeof Icon>[0]["name"];
	tone: "positive" | "neutral";
	value: number;
	label: string;
}) {
	return (
		<div className="flex items-center gap-2.5 rounded border border-line bg-surface px-3.5 py-2.5">
			<span
				className={cn(
					"flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
					tone === "positive"
						? "bg-state-approved-fill text-state-approved"
						: "bg-surface-sunken text-ink-subtle",
				)}
			>
				<Icon name={icon} className="h-3.5 w-3.5" />
			</span>
			<p className="text-sm">
				<span className="font-semibold text-ink tabular">{value}</span>{" "}
				<span className="text-ink-muted">{label}</span>
			</p>
		</div>
	);
}
