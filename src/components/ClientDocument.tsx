import { ProposalProse } from "@/components/ProposalProse";
import { formatDateLong } from "@/lib/format";

/**
 * The proposal as a client reads it.
 *
 * Shared by the public `/p/[token]` page and the authenticated preview, so
 * that what a salesperson checks before sending is the same rendering the
 * client receives — not a second implementation that looks similar until one
 * of them changes.
 *
 * Deliberately unlike the rest of the application: serif, generous measure, no
 * chrome. A client should not be able to tell what tool produced this.
 */
export function ClientDocument({
  clientName,
  companyName,
  salespersonName,
  dateOfCall,
  isSuperseded,
  firstSentAt,
  updatedAt,
  sections,
}: {
  clientName: string | null;
  companyName: string | null;
  salespersonName: string | null;
  dateOfCall: string | null;
  version: number;
  isSuperseded: boolean;
  firstSentAt: string | null;
  updatedAt: string;
  sections: Array<{ title: string; content: string | null; position: number }>;
}) {
  return (
    <main className="mx-auto max-w-prose px-6 py-20 sm:py-28">
      <header className="animate-rise">
        <p className="font-sans text-2xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
          Koya Talent
        </p>

        <h1 className="mt-5 font-serif text-4xl font-semibold leading-tight tracking-tight text-ink">
          Proposal for {clientName ?? companyName}
        </h1>

        <p className="mt-3 font-sans text-sm text-ink-muted">
          {salespersonName && <>Prepared by {salespersonName}</>}
          {salespersonName && dateOfCall && (
            <span className="mx-1.5 text-ink-subtle">·</span>
          )}
          {dateOfCall && formatDateLong(dateOfCall)}
        </p>

        {/*
          A document that changes under a reader with no acknowledgement is its
          own kind of dishonesty. When the token has followed the chain
          forward, the page says so and dates it.
        */}
        {isSuperseded && (
          <p className="mt-6 rounded border border-line bg-surface-sunken px-4 py-3 font-sans text-sm text-ink-muted">
            <span className="font-medium text-ink">
              Updated {formatDateLong(updatedAt)}.
            </span>
            {firstSentAt && (
              <> This replaces the version sent on {formatDateLong(firstSentAt)}.</>
            )}
          </p>
        )}
      </header>

      <hr className="my-10 border-line" />

      <article className="space-y-10">
        {sections
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
  );
}
