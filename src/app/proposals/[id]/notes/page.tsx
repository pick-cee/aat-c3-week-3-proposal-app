import { notFound } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { NotesCapture } from "@/components/NotesCapture";
import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import type { Proposal, SupportingMaterial } from "@/lib/db/types";

export default async function NotesPage({
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

	if (proposal.author_id !== actor.id) notFound();

	const { data: materialRows } = await db
		.from("supporting_materials")
		.select("*")
		.eq("proposal_id", id)
		.order("created_at", { ascending: true });

	return (
		<AppShell actor={actor} backTo="/queue">
			<div className="max-w-3xl">
				<h1 className="text-3xl font-semibold tracking-tight text-ink">
					What came out of the call?
				</h1>
				<p className="mt-2 max-w-xl text-ink-muted">
					Paste your notes and drop in anything the client sent. Claude reads
					both and fills in the intake form — you check it before anything is
					written.
				</p>

				<div className="mt-8">
					<NotesCapture
						proposalId={id}
						materials={(materialRows ?? []) as SupportingMaterial[]}
						initialNotes={proposal.raw_notes ?? ""}
					/>
				</div>
			</div>
		</AppShell>
	);
}
