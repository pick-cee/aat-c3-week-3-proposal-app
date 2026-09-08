import { INTAKE_FIELD_KEYS, type IntakeFields } from "@/lib/db/types";

export interface RawProposal {
  value?: unknown;
  source?: unknown;
}

export interface ExtractedField {
  value: string;
  /** The span of the source that supports it, verified to appear there. */
  source: string;
}

export interface VerificationOutcome {
  fields: Partial<Record<keyof IntakeFields, ExtractedField>>;
  dropped: Array<{ field: keyof IntakeFields; reason: string }>;
}

/**
 * Quotes rarely survive a round trip byte-for-byte: models normalise smart
 * quotes, collapse newlines that were line breaks in the notes, and adjust
 * spacing. Normalising both sides keeps the check strict about CONTENT while
 * tolerant about typography — the alternative is dropping good values over an
 * apostrophe.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Below this a "quote" is a fragment that would match almost any text. */
const MIN_QUOTE_LENGTH = 8;

export function verifyProposals(
  proposals: Record<string, RawProposal | null>,
  sourceText: string,
): VerificationOutcome {
  const haystack = normalize(sourceText);
  const fields: VerificationOutcome["fields"] = {};
  const dropped: VerificationOutcome["dropped"] = [];

  for (const field of INTAKE_FIELD_KEYS) {
    const proposal = proposals[field];

    // Null is a complete answer, and the expected one for anything the notes
    // did not cover.
    if (proposal === null || proposal === undefined) continue;

    const value = asString(proposal.value);
    const source = asString(proposal.source);

    if (!value) continue; // proposed nothing; same as null

    if (!source) {
      dropped.push({
        field,
        reason: "proposed without quoting a source",
      });
      continue;
    }

    if (normalize(source).length < MIN_QUOTE_LENGTH) {
      dropped.push({
        field,
        reason: `quoted only "${source}", too short to verify`,
      });
      continue;
    }

    if (!haystack.includes(normalize(source))) {
      // The model produced a value and a justification that is not in the
      // source. That is the exact failure this check exists for.
      dropped.push({
        field,
        reason: `quoted "${truncate(source)}", which does not appear in the notes`,
      });
      continue;
    }

    fields[field] = { value, source };
  }

  return { fields, dropped };
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  // A model asked for a string sometimes returns a number for a price.
  if (typeof value === "number") return String(value);

  return null;
}

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * Which provenance entries survive an edit.
 *
 * A source phrase that no longer supports the value in the field is worse than
 * no source at all: the form would show a quotation appearing to justify a
 * number nobody extracted. So an edited field becomes hand-typed, and this is
 * decided by comparing values rather than trusting the client to report it.
 */
export function survivingProvenance(
  extracted: Partial<Record<keyof IntakeFields, ExtractedField>>,
  submitted: Partial<IntakeFields>,
): Record<string, { source: string; confirmed: boolean }> {
  const kept: Record<string, { source: string; confirmed: boolean }> = {};

  for (const field of INTAKE_FIELD_KEYS) {
    const proposal = extracted[field];
    if (!proposal) continue;

    const current = (submitted[field] ?? "").trim();
    if (current === "" || current !== proposal.value.trim()) continue;

    kept[field] = { source: proposal.source, confirmed: true };
  }

  return kept;
}
