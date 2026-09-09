import { TO_BE_CONFIRMED } from "@/lib/constants";
import type { IntakeFields } from "@/lib/db/types";
import type { SectionDefinition } from "@/lib/sections";

/**
 * Timeline and Pricing, rendered from intake rather than generated
 * (DESIGN.md section 6).
 *
 * These are the two fields where an invented value does the most damage, and
 * there is no judgment in them — so no model touches them. Asking one to
 * "phrase this nicely" is asking it to retype a number, which is exactly the
 * operation that can silently change it.
 *
 * What a model would have contributed is presentation, and presentation can be
 * done deterministically: the value is placed on its own line, given its own
 * emphasis, and surrounded by prose that reads as a document rather than a form
 * field with a sentence stapled either side.
 *
 * This is also what makes `[To be confirmed]` structural — it is what the
 * renderer emits when the value is absent, not an instruction a model has to
 * respect.
 */

/** Absent, empty and whitespace-only are the same thing: we do not have it. */
function valueOrMarker(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? TO_BE_CONFIRMED : trimmed;
}

/**
 * Presents a value on its own line, as a bullet if the salesperson wrote
 * several.
 *
 * Notes routinely carry a value like "Discovery 2 weeks, build 6 weeks, UAT 2
 * weeks" — one line of comma-separated phases. Rendering that as a single
 * paragraph buries the structure the salesperson already expressed; splitting
 * it restores the structure WITHOUT changing a character of the content.
 *
 * Deliberately conservative: it splits only on newlines, semicolons, and
 * bullet-ish leading characters. It does NOT split on commas, because
 * "₦18,500,000" and "10 weeks, starting late October" would both be mangled.
 */
function present(value: string): string {
  if (value === TO_BE_CONFIRMED) {
    return `**${TO_BE_CONFIRMED}**`;
  }

  const parts = value
    .split(/\n+|;\s*/)
    .map((part) => part.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return parts.map((part) => `- ${part}`).join("\n");
  }

  // A single value gets emphasis so the eye lands on it rather than on the
  // boilerplate around it.
  return `**${value}**`;
}

export function renderTemplateSection(
  definition: SectionDefinition,
  intake: Partial<IntakeFields>,
): string {
  switch (definition.key) {
    case "timeline":
      return renderTimeline(intake);
    case "pricing":
      return renderPricing(intake);
    default:
      throw new Error(
        `renderTemplateSection called for "${definition.key}", which is generated, not rendered.`,
      );
  }
}

function renderTimeline(intake: Partial<IntakeFields>): string {
  const value = valueOrMarker(intake.proposed_timeline);
  const missing = value === TO_BE_CONFIRMED;

  return [
    missing
      ? "We will confirm the delivery schedule with you:"
      : "We estimate this project can be completed within:",
    "",
    present(value),
    "",
    missing
      ? "Once the schedule is agreed it will include implementation, testing, and a period for your feedback."
      : "This includes implementation, testing, and a period for your feedback before handover.",
  ].join("\n");
}

function renderPricing(intake: Partial<IntakeFields>): string {
  const value = valueOrMarker(intake.estimated_pricing);
  const missing = value === TO_BE_CONFIRMED;

  return [
    missing
      ? "Pricing for this engagement:"
      : "The estimated cost for this engagement is:",
    "",
    present(value),
    "",
    missing
      ? "We will confirm this with you before any work begins."
      : "If your needs change during the project, we will work with you to adjust the scope and pricing together.",
  ].join("\n");
}

/** True when a rendered section is showing the marker rather than a real value. */
export function isAwaitingValue(content: string | null): boolean {
  return (content ?? "").includes(TO_BE_CONFIRMED);
}
