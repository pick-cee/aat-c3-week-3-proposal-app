

/** Past five attempts the prompt is wrong, not the sample. */
export const MAX_REGENERATIONS_PER_SECTION = 5;

/**
 * Counts every material on a version however it arrived, inherited included —
 * a cap that resets on each fork bounds nothing.
 */
export const MAX_MATERIALS_SUMMARIZED = 10;

/**
 * Counted across ALL sessions, not per-user: with shared demo accounts a
 * per-user limit is sidestepped by signing in as the other one.
 */
export const GENERATIONS_PER_HOUR_GLOBAL = 60;

// --- Queue (DESIGN.md section 9) -----------------------------------------

/** A proposal in review past this is surfaced on the queue as waiting. */
export const STALE_IN_REVIEW_HOURS = 48;

// --- Extraction (DESIGN.md section 7) ------------------------------------

/**
 * Below this many characters a file is `empty`, not `ok`. A successful parse
 * that yields nothing usable is a distinct outcome from a successful parse.
 */
export const MIN_USEFUL_CHARS = 25;

/** A 200-page PDF is truncated with a visible note rather than sent whole. */
export const MAX_EXTRACTED_CHARS_PER_FILE = 40_000;

/** Total across all materials on one proposal. */
export const MAX_EXTRACTED_CHARS_TOTAL = 120_000;

// --- Documents -----------------------------------------------------------

/** What the client document shows where an intake value is missing. */
export const TO_BE_CONFIRMED = "[To be confirmed]";

// --- Models (DESIGN.md section 6) ----------------------------------------

/** Mechanical, many files, no judgment. */
export const MODEL_SUMMARIZE = "claude-haiku-4-5";

/** Client-facing prose, one call per section. */
export const MODEL_WRITE = "claude-sonnet-5";

/**
 * USD per million tokens, for the running cost display in the editor.
 * Model choice follows the ratio of judgment to volume, and this is the
 * ratio it is trading against.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
};

/** Cost in USD of one call, from the token counts recorded on it. */
export function costOf(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0; // template sections and unknown models cost nothing
  return (
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output
  );
}
