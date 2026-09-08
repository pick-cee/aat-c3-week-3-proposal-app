import {
  INTAKE_FIELD_KEYS,
  INTAKE_FIELD_LABELS,
  type IntakeFields,
  type SectionKey,
  type StaleReason,
} from "@/lib/db/types";
import { sectionDefinition } from "@/lib/sections";


/** Normalized so trailing whitespace is not a change. Null and "" are equal. */
function normalize(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Which intake fields changed between the snapshot and current values.
 *
 * A section with no snapshot (an older row, or a template section) reports no
 * drift: we cannot know what it was written from, and inventing a "changed"
 * marker from missing evidence would be its own kind of lie.
 */
export function intakeDrift(
  snapshot: IntakeFields | null,
  current: Partial<IntakeFields>,
): StaleReason[] {
  if (!snapshot) return [];

  return INTAKE_FIELD_KEYS.filter(
    (field) => normalize(snapshot[field]) !== normalize(current[field]),
  ).map((field) => ({ kind: "intake" as const, field }));
}

/**
 * Merge new reasons into existing ones without duplicating. Staleness
 * accumulates: two intake edits before a regeneration leave two markers, and a
 * regeneration on top of an intake edit leaves both kinds.
 */
export function mergeStaleReasons(
  existing: StaleReason[],
  incoming: StaleReason[],
): StaleReason[] {
  const seen = new Set(existing.map(keyOf));
  const merged = [...existing];

  for (const reason of incoming) {
    if (!seen.has(keyOf(reason))) {
      seen.add(keyOf(reason));
      merged.push(reason);
    }
  }

  return merged;
}

function keyOf(reason: StaleReason): string {
  return reason.kind === "intake"
    ? `intake:${reason.field}`
    : `section:${reason.section_key}`;
}

/**
 * The marker text for a section card. Reads as a sentence about this section
 * rather than a status code, and names what actually changed — that is what
 * makes it worth acting on.
 */
export function stalenessMessage(reasons: StaleReason[]): string | null {
  if (reasons.length === 0) return null;

  const intakeFields = reasons
    .filter((r): r is Extract<StaleReason, { kind: "intake" }> => r.kind === "intake")
    .map((r) => INTAKE_FIELD_LABELS[r.field]);

  const sections = reasons
    .filter((r): r is Extract<StaleReason, { kind: "section" }> => r.kind === "section")
    .map((r) => sectionDefinition(r.section_key).title);

  const parts: string[] = [];

  if (intakeFields.length > 0) {
    parts.push(
      `Intake changed since this was written: ${listOf(intakeFields)}.`,
    );
  }

  if (sections.length > 0) {
    parts.push(
      `${listOf(sections)} ${sections.length === 1 ? "was" : "were"
      } regenerated after this was written.`,
    );
  }

  return parts.join(" ");
}

function listOf(items: string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * The snapshot to store when a section is generated.
 *
 * Built by explicit reduce rather than `Object.fromEntries`, which widens the
 * key type to `string` and would need a cast to satisfy `IntakeFields`. The
 * cast would also hide a field going missing from the snapshot — exactly the
 * bug that makes later diffs report phantom changes.
 */
export function snapshotIntake(intake: Partial<IntakeFields>): IntakeFields {
  const snapshot = {} as IntakeFields;

  for (const field of INTAKE_FIELD_KEYS) {
    snapshot[field] = intake[field] ?? null;
  }

  return snapshot;
}

/** Staleness markers a regeneration of `key` places on the sections after it. */
export function regenerationStaleReason(key: SectionKey): StaleReason {
  return { kind: "section", section_key: key };
}
