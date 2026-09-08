import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import {
  classifyModelError,
  getAnthropic,
  textOf,
  usageOf,
  type Usage,
} from "@/lib/anthropic";
import { MODEL_SUMMARIZE } from "@/lib/constants";

/**
 * Haiku summarizes supporting materials (DESIGN.md section 6).
 *
 * Mechanical, potentially several files per proposal, no judgment required —
 * which is exactly the ratio of volume to judgment that makes Haiku the right
 * model. Sonnet writes the prose; it never reads raw files.
 *
 * The summary is what generation sees. Sending raw extracted text into four
 * section calls would multiply a 40,000-character PDF across every one of them.
 */

const SYSTEM_PROMPT = `You summarize supporting documents for a sales proposal.

Your summary is the ONLY form in which this document reaches the proposal
writer. Anything you leave out is lost.

Extract and preserve:
- Concrete facts: names, systems, team sizes, volumes, dates, constraints
- Any figure or price that appears, quoted exactly as written
- Requirements, must-haves, and explicit exclusions
- Anything that contradicts or qualifies what a salesperson might assume

Rules:
- Report only what the document says. Never infer, extrapolate, or fill gaps.
- Quote figures and dates exactly. Do not round, convert, or reformat them.
- If the document is mostly irrelevant to a proposal, say so in one line
  rather than padding a summary out of nothing.
- No preamble. Start with the content.

Aim for 200 words. Go shorter when the document is thin.`;

export interface MaterialToSummarize {
  filename: string;
  mimeType: string | null;
  /** Parsed text, for docx/spreadsheet/text. */
  text: string | null;
  /** Raw bytes, for PDFs and images that go up as blocks. */
  bytes: Uint8Array | null;
  passthrough: "document" | "image" | null;
}

export interface SummaryResult {
  summary: string;
  usage: Usage;
}

export async function summarizeMaterial(
  material: MaterialToSummarize,
): Promise<SummaryResult> {
  const content = buildContent(material);

  try {
    const message = await getAnthropic().messages.create({
      model: MODEL_SUMMARIZE,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const summary = textOf(message);

    if (summary === "") {
      // A successful call that produced nothing is not a summary. Treated as a
      // failure so the material is marked rather than silently carrying an
      // empty string into generation.
      throw new Error("Claude returned an empty summary.");
    }

    return { summary, usage: usageOf(message) };
  } catch (error) {
    throw classifyModelError(error);
  }
}

function buildContent(
  material: MaterialToSummarize,
): Anthropic.ContentBlockParam[] {
  const instruction = `Summarize this document, titled "${material.filename}".`;

  if (material.passthrough === "document" && material.bytes) {
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: Buffer.from(material.bytes).toString("base64"),
        },
      },
      { type: "text", text: instruction },
    ];
  }

  if (material.passthrough === "image" && material.bytes) {
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: imageMediaType(material.mimeType, material.filename),
          data: Buffer.from(material.bytes).toString("base64"),
        },
      },
      {
        type: "text",
        text:
          `${instruction} If it is a screenshot, diagram or table, describe ` +
          `what it shows and transcribe any text or figures in it.`,
      },
    ];
  }

  return [
    {
      type: "text",
      text: `${instruction}\n\n---\n\n${material.text ?? ""}`,
    },
  ];
}

/**
 * The API accepts a fixed set of image types, so an unrecognized MIME type has
 * to become one of them rather than being passed through. The extension is the
 * better signal — see `formats.ts` on why browsers disagree here.
 */
function imageMediaType(
  mimeType: string | null,
  filename: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";

  switch (mimeType) {
    case "image/png":
      return "image/png";
    case "image/gif":
      return "image/gif";
    case "image/webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}
