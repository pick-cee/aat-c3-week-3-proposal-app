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
import {
  verifyProposals,
  type ExtractedField,
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
  "estimated_pricing": null,
  ...
}

Every one of the eleven fields must appear, as either an object with "value" and "source", or null.`;

export interface ExtractionInput {
  notes: string;
  /** Summaries of any uploaded materials, which are also valid sources. */
  materialSummaries: Array<{ filename: string; summary: string }>;
}

export interface ExtractionResult {
  /** Proposed values that survived verification. */
  fields: Partial<Record<keyof IntakeFields, ExtractedField>>;
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
  const { fields, dropped } = verifyProposals(parsed, searchableText(input));

  return { fields, usage, dropped };
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

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<
      string,
      RawProposal
    >;
  } catch {
    throw new Error(
      "Claude returned malformed JSON. Nothing has been saved — try again, or " +
      "fill the form in directly.",
    );
  }
}
