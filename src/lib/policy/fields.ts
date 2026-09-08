import {
  INTAKE_FIELD_LABELS,
  type FieldGap,
  type FieldTier,
  type IntakeFields,
} from "@/lib/db/types";

export const FIELD_TIERS: Record<keyof IntakeFields, FieldTier> = {
  // Block — there is no proposal without these.
  client_name: "block",
  company_name: "block",
  client_email: "block",
  client_needs_summary: "block",
  project_scope: "block",

  // Warn — generation allowed after explicit confirmation; the gap is recorded
  // and the document carries [To be confirmed].
  estimated_pricing: "warn",
  proposed_timeline: "warn",
  recommended_services: "warn",

  // Mark — generates normally, gap noted in the UI and logged.
  date_of_call: "mark",
  salesperson_name: "mark",
  goals_and_objectives: "mark",
};

/** What each tier does, in the words shown to the user. */
const TREATMENTS: Record<FieldTier, string> = {
  block: "Generation is disabled until this is filled in.",
  warn: "Generated with [To be confirmed] in place of this value.",
  mark: "Generated without this; the gap is recorded.",
};

/** Empty, whitespace-only and null all count as missing. Absent is absent. */
function isMissing(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

export function fieldsOfTier(tier: FieldTier): (keyof IntakeFields)[] {
  return (Object.keys(FIELD_TIERS) as (keyof IntakeFields)[]).filter(
    (f) => FIELD_TIERS[f] === tier,
  );
}

/**
 * Every gap in the intake, with how each will be treated. Written to
 * `field_gaps` at generation time so the record says what was missing *then*,
 * not what is missing now.
 */
export function findGaps(intake: Partial<IntakeFields>): FieldGap[] {
  return (Object.keys(FIELD_TIERS) as (keyof IntakeFields)[])
    .filter((field) => isMissing(intake[field]))
    .map((field) => ({
      field,
      tier: FIELD_TIERS[field],
      treatment: TREATMENTS[FIELD_TIERS[field]],
    }));
}

export interface GenerationReadiness {
  canGenerate: boolean;
  /** Missing Block fields. Non-empty means generation is refused. */
  blocking: FieldGap[];
  /** Missing Warn fields. Requires explicit confirmation to proceed. */
  warnings: FieldGap[];
  /** Missing Mark fields. Noted, never in the way. */
  marks: FieldGap[];
  /** Plain-language reason, or null when generation can proceed. */
  reason: string | null;
}

/**
 * Whether this proposal can be generated, and why not if it cannot.
 *
 * `confirmedWarnings` is the salesperson having explicitly accepted the Warn
 * gaps. Defaults to false so the safe path is the one you get by forgetting a
 * parameter.
 */
export function assessReadiness(
  intake: Partial<IntakeFields>,
  confirmedWarnings = false,
): GenerationReadiness {
  const gaps = findGaps(intake);
  const blocking = gaps.filter((g) => g.tier === "block");
  const warnings = gaps.filter((g) => g.tier === "warn");
  const marks = gaps.filter((g) => g.tier === "mark");

  if (blocking.length > 0) {
    const names = blocking.map((g) => INTAKE_FIELD_LABELS[g.field]).join(", ");
    return {
      canGenerate: false,
      blocking,
      warnings,
      marks,
      reason: `There is no proposal without ${names}. Fill ${blocking.length === 1 ? "it" : "them"
        } in on the intake form to generate.`,
    };
  }

  if (warnings.length > 0 && !confirmedWarnings) {
    const names = warnings.map((g) => INTAKE_FIELD_LABELS[g.field]).join(", ");
    return {
      canGenerate: false,
      blocking,
      warnings,
      marks,
      reason: `${names} ${warnings.length === 1 ? "is" : "are"
        } missing. The proposal will show "[To be confirmed]" instead — confirm to generate anyway.`,
    };
  }

  return { canGenerate: true, blocking, warnings, marks, reason: null };
}
