import "server-only";

import {
  classifyModelError,
  getAnthropic,
  textOf,
  usageOf,
  type Usage,
} from "@/lib/anthropic";
import { MODEL_WRITE } from "@/lib/constants";
import {
  INTAKE_FIELD_KEYS,
  INTAKE_FIELD_LABELS,
  type IntakeFields,
} from "@/lib/db/types";
import { repairJson } from "./repair-json";
import {
  verifyProposals,
  type ExtractedField,
  type PartialSupport,
  type RawProposal,
} from "./verify";


const SYSTEM_PROMPT = `You read messy discovery-call notes and pull out structured facts for a sales proposal.

You are NOT writing the proposal. You are reading what a salesperson wrote down and reporting what is actually in it.

THE RULE THAT MATTERS MOST

For every field, return either a value that the source genuinely supports, or null. Never both guess and hedge — null is a complete answer and the form handles it.

- If the notes do not mention something, return null. Do not infer it from context, do not reconstruct it from what a proposal "usually" contains.
- Every value must come with a QUOTE from the source: the exact words, copied character for character, that support it. Not a paraphrase, not a summary of your reasoning.
- If you cannot quote the source, you do not have a value. Return null.

HEDGED LANGUAGE IS NOT A COMMITMENT

"Maybe around forty grand, depends on scope" supports NO price. "We landed on £48,000" does.
"Sometime in the spring, we'll see" supports NO timeline. "Ten weeks from kickoff" does.

A salesperson half-committing in their own notes has not committed. Reporting it as a value puts a number in front of a client that nobody agreed to. When in doubt, return null — an empty field costs someone thirty seconds; a wrong price costs a deal.

WHEN THE SOURCE ALMOST GAVE YOU A VALUE, SAY SO

Sometimes the notes touch a field without settling it: a date with no year, a figure with no currency, a duration hedged into meaninglessness. The value is still null — you do not fill the gap. But say why, so the salesperson knows the difference between "we never discussed this" and "we discussed it and it was incomplete". Those need different actions from them.

Return null for the value, plus the quote that came close and a short reason:

  "date_of_call": {"value": null, "source": "Call 14 Oct", "reason": "no year given"}

Rules for this:
- ONLY when the source genuinely touches the field. If the notes say nothing about pricing at all, return a plain null — do not manufacture an explanation for silence.
- The quote must be real, copied from the source exactly like any other.
- The reason is one short phrase naming what is missing. Not a sentence, not an apology, not a suggestion.

If a field is simply absent from the notes, return null with nothing else. Most empty fields are this.

FIELD NOTES

- client_name — the individual contact, not the company.
- company_name — the organisation.
- client_email — only if an actual address appears.
- date_of_call — ISO format (YYYY-MM-DD) if a date is stated or clearly derivable from an explicit reference. Null for "last Tuesday" with no anchor date.
- salesperson_name — who ran the call, if named.
- client_needs_summary — the problem in their words, condensed. This is the one field where light rephrasing is acceptable, because notes are fragments. Stay close to what was said.
- project_scope — what they want built or delivered.
- goals_and_objectives — the outcomes they want.
- recommended_services — what we proposed doing. Null if the notes only record their problem, not our answer.
- proposed_timeline — a duration or window, only if stated.
- estimated_pricing — a figure or range, only if stated. Quote the currency exactly as written.

OUTPUT

Return ONLY a JSON object, no prose around it, shaped:

{
  "client_name": {"value": "Dana Whitfield", "source": "spoke with Dana Whitfield, ops director"},
  "date_of_call": {"value": null, "source": "Call 14 Oct", "reason": "no year given"},
  "estimated_pricing": null,
  ...
}

Every one of the eleven fields must appear, as one of:
  - {"value": "...", "source": "..."}            — found it, here is the proof
  - {"value": null, "source": "...", "reason": "..."} — nearly, here is what was missing
  - null                                          — not in the source at all`;

export interface ExtractionInput {
  notes: string;
  /** Summaries of any uploaded materials, which are also valid sources. */
  materialSummaries: Array<{ filename: string; summary: string }>;
}

export interface ExtractionResult {
  /** Proposed values that survived verification. */
  fields: Partial<Record<keyof IntakeFields, ExtractedField>>;
  /**
   * Fields left null where the source came close, with the quote that nearly
   * supported them. Shown under the empty input so "not discussed" and
   * "discussed but incomplete" stop looking identical.
   */
  partial: Partial<Record<keyof IntakeFields, PartialSupport>>;
  usage: Usage;
  /**
   * Values the model proposed but whose quote could not be found in the
   * source. Dropped, and reported so the behaviour is visible rather than
   * silent.
   */
  dropped: Array<{ field: keyof IntakeFields; reason: string }>;
}

export async function extractIntake(
  input: ExtractionInput,
): Promise<ExtractionResult> {
  const sources = buildSources(input);

  if (sources.trim() === "") {
    throw new Error("There is nothing to read — add notes or upload a file.");
  }

  let raw: string;
  let usage: Usage;

  try {
    const message = await getAnthropic().messages.create({
      model: MODEL_WRITE,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: sources }],
    });

    raw = textOf(message);
    usage = usageOf(message);
  } catch (error) {
    throw classifyModelError(error);
  }

  const parsed = parseResponse(raw);

  // The quote has to actually appear in the source. See `verify.ts` — this is
  // the difference between provenance and a plausible-looking citation.
  const { fields, partial, dropped } = verifyProposals(
    parsed,
    searchableText(input),
  );

  return { fields, partial, usage, dropped };
}

function buildSources(input: ExtractionInput): string {
  const parts: string[] = [];

  if (input.notes.trim()) {
    parts.push("# Discovery-call notes\n", input.notes.trim(), "");
  }

  if (input.materialSummaries.length > 0) {
    parts.push("# Supporting documents the client provided\n");
    for (const material of input.materialSummaries) {
      parts.push(`## ${material.filename}\n\n${material.summary}\n`);
    }
  }

  parts.push(
    "\n# Fields to extract\n",
    INTAKE_FIELD_KEYS.map(
      (field) => `- ${field} (${INTAKE_FIELD_LABELS[field]})`,
    ).join("\n"),
  );

  return parts.join("\n");
}

/**
 * The text a quote must be findable in. Deliberately the same content the
 * model saw, minus the instructions — so a model quoting the field list back
 * cannot pass verification.
 */
function searchableText(input: ExtractionInput): string {
  return [
    input.notes,
    ...input.materialSummaries.map((m) => m.summary),
  ].join("\n\n");
}

/**
 * Models wrap JSON in prose or fences however firmly you ask them not to.
 * Parsing tolerantly here is not the same as trusting the content — every
 * value still has to survive verification.
 */
function parseResponse(raw: string): Record<string, RawProposal> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      "Claude did not return usable JSON. The notes were not read — nothing " +
      "has been saved, and you can try again or fill the form in directly.",
    );
  }

  const slice = candidate.slice(start, end + 1);

  try {
    return JSON.parse(slice) as Record<string, RawProposal>;
  } catch (firstError) {
    // Try to repair before giving up.
    //
    // The `source` field is a verbatim quote from the notes, so it routinely
    // contains the two things that break JSON: raw newlines (notes are
    // multi-line) and unescaped double quotes (a salesperson writing
    // `the "where is my delivery" calls` is quoting the client). The model is
    // asked to escape them and mostly does — but "mostly" means a salesperson
    // occasionally loses an entire extraction to a punctuation mark.
    //
    // Repairing is safe here because the content is not trusted anyway: every
    // value still has to survive `verifyProposals`, which checks the quote
    // actually appears in the source.
    try {
      return JSON.parse(repairJson(slice)) as Record<string, RawProposal>;
    } catch {
      // Fall through and report the ORIGINAL error, which describes what the
      // model actually produced rather than what repair made of it.
    }

    const error = firstError;
    // Keep the raw response.
    //
    // This used to throw a bare "malformed JSON", which threw away the only
    // thing that could explain WHY — leaving nobody able to tell a truncated
    // response from an unescaped quote from a model that wrapped its answer in
    // prose. Every other failure in this application keeps the provider's own
    // error for exactly this reason; this one did not.
    const detail = error instanceof Error ? error.message : String(error);
    const truncated = raw.length > 1200 ? `${raw.slice(0, 1200)}…` : raw;

    console.error(
      `[extract] JSON parse failed: ${detail}` +
        `\n--- raw response (${raw.length} chars) ---\n${truncated}`,
    );

    throw new ExtractionParseError(detail, raw);
  }
}

/**
 * A parse failure that carries the response that caused it.
 *
 * The user-facing message stays plain — they can retry or fill the form in —
 * but the raw text reaches the log and the activity trail, so the next
 * occurrence is diagnosable instead of a shrug.
 */
export class ExtractionParseError extends Error {
  constructor(
    readonly detail: string,
    readonly raw: string,
  ) {
    super(
      "Claude did not return the expected format. Nothing has been saved — " +
        "try again, or fill the form in directly.",
    );
    this.name = "ExtractionParseError";
  }
}

