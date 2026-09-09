import { notFound } from "next/navigation";

import { createClient } from "@supabase/supabase-js";

import { ProposalProse } from "@/components/ProposalProse";
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

	const date = (value: string) =>
		new Date(value).toLocaleDateString("en-GB", {
			day: "numeric",
			month: "long",
			year: "numeric",
		});

	return (
		<div className="min-h-screen bg-surface">
			<main className="mx-auto max-w-prose px-6 py-20 sm:py-28">
				<header className="animate-rise">
					<p className="font-sans text-2xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
						Koya Talent
					</p>

					<h1 className="mt-5 font-serif text-4xl font-semibold leading-tight tracking-tight text-ink">
						Proposal for {proposal.client_name ?? proposal.company_name}
					</h1>

					<p className="mt-3 font-sans text-sm text-ink-muted">
						{proposal.salesperson_name && (
							<>Prepared by {proposal.salesperson_name}</>
						)}
						{proposal.salesperson_name && proposal.date_of_call && (
							<span className="mx-1.5 text-ink-subtle">·</span>
						)}
						{proposal.date_of_call && date(proposal.date_of_call)}
					</p>

					{/*
            A document that changes under a reader with no acknowledgement is
            its own kind of dishonesty. When the token has followed the chain
            forward, the page says so and dates it.
          */}
					{proposal.is_superseded && (
						<p className="mt-6 rounded border border-line bg-surface-sunken px-4 py-3 font-sans text-sm text-ink-muted">
							<span className="font-medium text-ink">
								Updated {date(proposal.updated_at)}.
							</span>
							{proposal.first_sent_at && (
								<>
									{" "}
									This replaces the version sent on{" "}
									{date(proposal.first_sent_at)}.
								</>
							)}
						</p>
					)}
				</header>

				<hr className="my-10 border-line" />

				<article className="space-y-10">
					{proposal.sections
						.filter((section) => section.content)
						.map((section, index) => (
							<section
								key={section.position}
								className="animate-rise"
								style={{ animationDelay: `${Math.min(index * 60, 300)}ms` }}
							>
								<h2 className="font-serif text-xl font-semibold text-ink">
									{section.title}
								</h2>
								<ProposalProse
								content={section.content!}
								tone="document"
								className="mt-3 font-serif text-[1.0625rem]"
							/>
							</section>
						))}
				</article>

				<footer className="mt-20 border-t border-line pt-6">
					<p className="font-sans text-xs text-ink-subtle">
						Koya Talent · This proposal was prepared for you and is not a public
						document.
					</p>
				</footer>
			</main>
		</div>
	);
}
