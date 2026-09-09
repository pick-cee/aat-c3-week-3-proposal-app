import { INTAKE_FIELD_KEYS, type IntakeFields } from "@/lib/db/types";

export interface RawProposal {
  value?: unknown;
  source?: unknown;
  /**
   * Why a field was left null when the source ALMOST supported it.
   * Only meaningful alongside `source` and a null `value`.
   */
  reason?: unknown;
}

export interface ExtractedField {
  value: string;
  /** The span of the source that supports it, verified to appear there. */
  source: string;
}

/**
 * A field extraction declined to fill, where the source nearly supported it.
 *
 * "Call 14 Oct" with no year does not give a date — filling one in would be
 * fabrication. But an empty field renders identically whether the notes never
 * mentioned it or mentioned it incompletely, and those call for different
 * actions: one needs asking the client, the other needs remembering which year
 * you were in.
 *
 * Same distinction as `unsupported` versus `empty` on an uploaded file, one
 * layer up.
 */
export interface PartialSupport {
  /** The span of the source that came close, verified to appear there. */
  source: string;
  /** What was missing, in words. */
  reason: string;
}

export interface VerificationOutcome {
  fields: Partial<Record<keyof IntakeFields, ExtractedField>>;
  /**
   * Only for fields the source touched but did not settle. A field genuinely
   * absent from the notes stays out of this map — a reason under every empty
   * input would be noise, and noise is how a real explanation gets skipped.
   */
  partial: Partial<Record<keyof IntakeFields, PartialSupport>>;
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
  const partial: VerificationOutcome["partial"] = {};
  const dropped: VerificationOutcome["dropped"] = [];

  /**
   * A quote has to appear in the source whether it is justifying a value or
   * explaining the absence of one. Without this, "the notes mention X but not
   * Y" is just as inventable as X itself — and an explanation nobody can check
   * is worse than no explanation, because it reads as evidence.
   */
  const quoteIsReal = (quote: string) =>
    normalize(quote).length >= MIN_QUOTE_LENGTH &&
    haystack.includes(normalize(quote));

  for (const field of INTAKE_FIELD_KEYS) {
    const proposal = proposals[field];

    // Null is a complete answer, and the expected one for anything the notes
    // did not cover.
    if (proposal === null || proposal === undefined) continue;

    const value = asString(proposal.value);
    const source = asString(proposal.source);
    const reason = asString(proposal.reason);

    if (!value) {
      // No value, but the model says the source came close. Keep the
      // explanation only if both halves survive checking — a verified quote
      // and something to say about it.
      if (source && reason && quoteIsReal(source)) {
        partial[field] = { source, reason };
      }

      // Otherwise silent: genuinely absent from the notes, or an explanation
      // that could not be substantiated. Both mean nothing to show.
      continue;
    }

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

  return { fields, partial, dropped };
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

/*
 * `survivingProvenance` used to live here. It was superseded by
 * `provenanceAfterEdit` in `app/actions/proposals.ts`, which works from the
 * STORED provenance rather than a fresh extraction result — the only version
 * that can run on an intake edit weeks after the notes were read.
 *
 * Removed rather than left in place: two implementations of "does this source
 * still support this value" would eventually disagree, and the dead one is the
 * one nobody remembers to update.
 */
