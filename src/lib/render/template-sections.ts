import { TO_BE_CONFIRMED } from "@/lib/constants";
import type { IntakeFields } from "@/lib/db/types";
import type { SectionDefinition } from "@/lib/sections";

/** Absent, empty and whitespace-only are the same thing: we do not have it. */
function valueOrMarker(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? TO_BE_CONFIRMED : trimmed;
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
  return [
    "We estimate this project can be completed within:",
    "",
    valueOrMarker(intake.proposed_timeline),
    "",
    "This includes implementation, testing, and feedback iteration.",
  ].join("\n");
}

function renderPricing(intake: Partial<IntakeFields>): string {
  return [
    "The estimated cost for this engagement is:",
    "",
    valueOrMarker(intake.estimated_pricing),
    "",
    "If your needs change during the project, we will work with you to adjust " +
    "the scope and pricing.",
  ].join("\n");
}

/** True when a rendered section is showing the marker rather than a real value. */
export function isAwaitingValue(content: string | null): boolean {
  return (content ?? "").includes(TO_BE_CONFIRMED);
}
