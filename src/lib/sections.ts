import type { IntakeFields, SectionKey, SectionSource } from "@/lib/db/types";

export interface SectionDefinition {
  key: SectionKey;
  title: string;
  position: number;
  source: SectionSource;
  /** For template sections: which intake field the card points at. */
  intakeField?: keyof IntakeFields;
}

export const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  { key: "introduction", title: "Introduction", position: 1, source: "generated" },
  { key: "solution", title: "Proposed Solution", position: 2, source: "generated" },
  { key: "deliverables", title: "Deliverables", position: 3, source: "generated" },
  {
    key: "timeline",
    title: "Timeline",
    position: 4,
    source: "template",
    intakeField: "proposed_timeline",
  },
  {
    key: "pricing",
    title: "Pricing",
    position: 5,
    source: "template",
    intakeField: "estimated_pricing",
  },
  { key: "next_steps", title: "Next Steps", position: 6, source: "generated" },
] as const;

/** The four Sonnet writes, in generation order. */
export const GENERATED_SECTIONS = SECTION_DEFINITIONS.filter(
  (s) => s.source === "generated",
);

export const TEMPLATE_SECTIONS = SECTION_DEFINITIONS.filter(
  (s) => s.source === "template",
);

export function sectionDefinition(key: SectionKey): SectionDefinition {
  const found = SECTION_DEFINITIONS.find((s) => s.key === key);
  if (!found) throw new Error(`Unknown section key: ${key}`);
  return found;
}

/**
 * Sections that come after the given one. Used when a regeneration makes the
 * following sections stale — they were written against a solution that has
 * since changed.
 */
export function generatedSectionsAfter(key: SectionKey): SectionDefinition[] {
  const from = sectionDefinition(key);
  return GENERATED_SECTIONS.filter((s) => s.position > from.position);
}
