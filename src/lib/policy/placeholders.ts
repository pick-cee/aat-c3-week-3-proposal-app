import { TO_BE_CONFIRMED } from "@/lib/constants";
import type { ProposalSection } from "@/lib/db/types";

/**
 * Which sections would reach the client still saying `[To be confirmed]`.
 *
 * The Warn tier asks for confirmation at GENERATION time — "this will show
 * [To be confirmed], generate anyway?" — and then never asks again. A
 * salesperson who agreed to that at nine in the morning could submit, get
 * approval, and email the client a proposal whose pricing section reads
 * "The estimated cost for this engagement is: [To be confirmed]", with nothing
 * between that decision and the client's inbox.
 *
 * The marker is deliberately conspicuous in the document. That only helps if
 * someone is looking at the document, and the whole point of an approval
 * workflow is that people are looking at summaries.
 *
 * So it is checked at each of the three gates that follow generation: submit,
 * approve, and send. Warned, never blocked — pricing genuinely is sometimes
 * TBC when a proposal goes out, and that is the salesperson's call. What is
 * not their call is it happening without anyone noticing.
 */
export function sectionsAwaitingValues(
  sections: ProposalSection[],
): ProposalSection[] {
  return sections.filter((s) => (s.content ?? "").includes(TO_BE_CONFIRMED));
}

/**
 * A sentence naming what is still unfilled, or null when nothing is.
 *
 * Names the sections rather than counting them: "Pricing still says
 * [To be confirmed]" is actionable, "1 placeholder remains" sends someone
 * hunting.
 */
export function placeholderWarning(
  sections: ProposalSection[],
): string | null {
  const awaiting = sectionsAwaitingValues(sections);
  if (awaiting.length === 0) return null;

  const names = awaiting.map((s) => s.title).join(" and ");

  return (
    `${names} still ${awaiting.length === 1 ? "says" : "say"} ` +
    `"${TO_BE_CONFIRMED}". The client will see that exactly as written.`
  );
}
