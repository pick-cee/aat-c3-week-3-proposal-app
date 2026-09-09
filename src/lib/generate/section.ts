import "server-only";

import {
  classifyModelError,
  getAnthropic,
  textOf,
  usageOf,
  type Usage,
} from "@/lib/anthropic";
import { MODEL_WRITE } from "@/lib/constants";
import type { IntakeFields, SectionKey } from "@/lib/db/types";
import {
  describeFabrications,
  verifyCommercialTerms,
  type NameWarning,
} from "@/lib/verify/commercial-terms";
import { checkMaterialUse } from "@/lib/verify/material-use";
import { buildSectionPrompt, systemPrompt } from "./prompts";


export interface GenerationAttempt {
  usage: Usage;
  outcome: "accepted" | "rejected" | "empty";
  /** Why it was rejected, for the activity log. */
  reason?: string;
}

export type GenerationOutcome =
  | {
    status: "ok";
    content: string;
    usage: Usage;
    warnings: NameWarning[];
    /** Every attempt made, in order. The last one is the accepted one. */
    attempts: GenerationAttempt[];
  }
  | {
    status: "failed";
    /** Plain-language cause, shown on the section. */
    reason: string;
    retryable: boolean;
    attempts: GenerationAttempt[];
  };

export interface GenerateSectionInput {
  sectionKey: SectionKey;
  intake: Partial<IntakeFields>;
  materialSummaries: Array<{ filename: string; summary: string }>;
  precedingSections: Array<{ title: string; content: string }>;
}

export async function generateSection(
  input: GenerateSectionInput,
): Promise<GenerationOutcome> {
  const attempts: GenerationAttempt[] = [];
  let feedback: string | undefined;

  // Two attempts total: the original and one retry. DESIGN.md section 6 —
  // rejected, retried once, then failed cleanly. A third attempt spends money
  // to roll the same dice again.
  for (let attempt = 1; attempt <= 2; attempt++) {
    let content: string;
    let usage: Usage;

    try {
      const message = await getAnthropic().messages.create({
        model: MODEL_WRITE,
        max_tokens: 2048,
        system: systemPrompt(),
        messages: [
          {
            role: "user",
            content: buildSectionPrompt({ ...input, rejectionFeedback: feedback }),
          },
        ],
      });

      content = textOf(message);
      usage = usageOf(message);
    } catch (error) {
      const failure = classifyModelError(error);
      return {
        status: "failed",
        reason: failure.message,
        retryable: failure.retryable,
        attempts,
      };
    }

    if (content === "") {
      // A successful call that returned nothing is not a section. Retried once
      // like any other malformed output.
      attempts.push({ usage, outcome: "empty", reason: "Claude returned nothing." });
      feedback = "Your previous attempt returned no text at all.";
      continue;
    }

    // The section key decides which name checks apply — see `checkNames`.
    const verification = verifyCommercialTerms(
      content,
      input.intake,
      input.sectionKey,
    );

    if (verification.ok) {
      // Did it actually use the documents the client sent?
      //
      // Instruction alone did not hold: proposals were written that referenced
      // no attachment at all, twice, and the details a client takes the trouble
      // to send are usually the specifics that make the proposal theirs. So it
      // is measured and retried, like a fabricated figure — but only on the
      // first attempt, and only for the sections where specifics belong.
      //
      // Introduction and Next Steps are exempt: an opening that thanks someone
      // and a close about signing an agreement have no business reciting depot
      // counts, and warning that they do not would be the false-positive
      // failure all over again.
      const CITES_DETAIL: SectionKey[] = ["solution", "deliverables"];

      if (
        attempt === 1 &&
        CITES_DETAIL.includes(input.sectionKey) &&
        input.materialSummaries.length > 0
      ) {
        const materialUse = checkMaterialUse(content, input.materialSummaries);

        if (materialUse.ignored) {
          attempts.push({
            usage,
            outcome: "rejected",
            reason: materialUse.note!,
          });
          feedback =
            `Your previous attempt did not use the documents the client sent. ` +
            `Read the summaries again and ground this section in what is ` +
            `actually in them — a named system, a volume, a constraint. Do not ` +
            `invent detail to satisfy this: use what is there.`;
          continue;
        }
      }

      attempts.push({ usage, outcome: "accepted" });
      return {
        status: "ok",
        content,
        usage,
        warnings: verification.warnings,
        attempts,
      };
    }

    const reason = describeFabrications(verification.fabrications);
    attempts.push({ usage, outcome: "rejected", reason });
    feedback = reason;
  }

  // Both attempts fabricated. The caller leaves the previous content in place —
  // a failed regeneration must never blank a section that was fine.
  return {
    status: "failed",
    reason:
      `Claude twice wrote figures or dates that are not in the intake, so the ` +
      `section was not saved. ${attempts.at(-1)?.reason ?? ""} ` +
      `Adding the missing values to the intake usually fixes this.`,
    retryable: true,
    attempts,
  };
}
