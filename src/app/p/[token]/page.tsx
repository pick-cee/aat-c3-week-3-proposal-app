import { notFound } from "next/navigation";

import { createClient } from "@supabase/supabase-js";

import { ClientDocument } from "@/components/ClientDocument";
import { env } from "@/lib/env";
import type { SharedProposal } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function ClientProposalPage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = await params;

	const db = createClient(
		env.NEXT_PUBLIC_SUPABASE_URL,
		env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
		{ auth: { persistSession: false } },
	);

	const { data } = await db.rpc("get_shared_proposal", { token });
	const proposal = data as SharedProposal | null;

	// An unknown token and a chain with nothing sent both arrive here as null,
	// and both render as 404 — telling them apart would be an oracle for
	// guessing tokens.
	if (!proposal) notFound();

	// The rendering itself lives in `ClientDocument`, shared with the
	// salesperson's preview. Two copies of this markup would look identical
	// until one of them was edited, and the one nobody notices drifting is the
	// one the client reads.
	return (
		<div className="min-h-screen bg-surface">
			<ClientDocument
				clientName={proposal.client_name}
				companyName={proposal.company_name}
				salespersonName={proposal.salesperson_name}
				dateOfCall={proposal.date_of_call}
				version={proposal.version}
				isSuperseded={proposal.is_superseded}
				firstSentAt={proposal.first_sent_at}
				updatedAt={proposal.updated_at}
				sections={proposal.sections}
			/>
		</div>
	);
}
