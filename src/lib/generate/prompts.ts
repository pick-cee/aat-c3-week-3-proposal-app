import {
  INTAKE_FIELD_LABELS,
  type IntakeFields,
  type SectionKey,
} from "@/lib/db/types";

const SYSTEM_PROMPT = `You write sections of client-facing sales proposals for Koya Talent, a talent and technology consultancy.

THE RULE THAT MATTERS MOST

Every figure, price, date, duration and name in this proposal is fixed. They come from the salesperson's notes and are given to you below.

- Never state a price, cost, rate or budget that is not in the intake.
- Never state a date, deadline, duration or timeframe that is not in the intake.
- Never invent a person's name, a company name, or a job title.
- If a value is missing, write around it. Do not estimate, do not use a placeholder figure, and do not say "typically" followed by a number.

A number you invent will be read by a client as a commitment the salesperson made. This is the one failure that cannot be walked back.

HOW TO WRITE

- Address the client directly as "you". Write as "we".
- Plain professional English. No marketing superlatives, no "cutting-edge", no "leverage" as a verb, no "in today's fast-paced world".
- Concrete and specific to what this client actually said. A sentence that would fit any client is a sentence to delete.
- Never invent capabilities, case studies, credentials or past clients.
- Markdown for structure. Do not include the section heading — it is added around your output.
- Return only the section prose. No preamble, no "Here is the section", no commentary.`;

export function systemPrompt(): string {
  return SYSTEM_PROMPT;
}

interface SectionBrief {
  instruction: string;
  /** Roughly how long, in words. Guidance, not a hard cap. */
  target: number;
}

const BRIEFS: Record<Extract<SectionKey, "introduction" | "solution" | "deliverables" | "next_steps">, SectionBrief> = {
  introduction: {
    instruction: `Write the opening section.

Open by addressing the client contact by name, exactly as it appears in "Client Name" above — this is a letter to a person, and a proposal that opens without naming them reads as a template. Name the company as written in "Company Name" too.

Then thank them for the conversation, show you understood their problem by restating it in your own words, and say what this document contains.\n\nIf they sent documents, draw on them here: naming something only they would know shows you actually read what they sent. Reference their actual situation — the specifics they described, not a generic summary.

Do not list deliverables, pricing or timeline here. Those have their own sections.`,
    target: 150,
  },

  solution: {
    instruction: `Write the proposed solution.

Explain the approach: what you will do, and why it fits what they described. Their documents are the richest source for this: where a summary names a system, a volume, a team size or a constraint, use it. Connect each part of the approach to something they actually said — a constraint, a system they already run, a goal they named.

Describe the approach, not a schedule and not a price. Both have their own sections.`,
    target: 250,
  },

  deliverables: {
    instruction: `Write the deliverables section.

List what they will actually receive, as a markdown bullet list with a short line of context for each. Be concrete: a document, a working system, a training session, a report.

Every deliverable must trace to the recommended services or project scope in the intake, or to something in the documents they sent. Where a document explains what a deliverable has to accommodate, say so. Do not add deliverables that sound impressive but were never discussed.

Do not attach dates or prices to individual deliverables.`,
    target: 200,
  },

  next_steps: {
    instruction: `Write the closing section.

Say what happens if they want to proceed — an agreement to formalise the engagement, then project start. Invite questions. Close warmly and briefly.

Do not restate the pricing or the timeline. Do not invent a deadline for their decision, and do not manufacture urgency.`,
    target: 100,
  },
};

export interface SectionPromptInput {
  sectionKey: SectionKey;
  intake: Partial<IntakeFields>;
  /** Haiku's summaries of the supporting materials, in upload order. */
  materialSummaries: Array<{ filename: string; summary: string }>;
  /** Already-written sections that come before this one, in order. */
  precedingSections: Array<{ title: string; content: string }>;
  /** Set on a retry after a rejection, so the second attempt knows what failed. */
  rejectionFeedback?: string;
  /**
   * What the salesperson asked for, in their own words.
   *
   * A regeneration without this is a re-roll: the model rewrites from the same
   * inputs and may land anywhere, including somewhere worse. The person
   * clicking the button almost always knows what they want changed, and the
   * only reason they could not say so was that nothing asked them.
   */
  userInstruction?: string;
  /**
   * The text being replaced.
   *
   * Sent only alongside an instruction, because an instruction like "make the
   * second paragraph shorter" or "drop the line about onboarding" is
   * meaningless without the thing it refers to.
   */
  currentContent?: string;
}

export function buildSectionPrompt(input: SectionPromptInput): string {
  const brief = BRIEFS[input.sectionKey as keyof typeof BRIEFS];

  if (!brief) {
    throw new Error(
      `No prompt for section "${input.sectionKey}" — Timeline and Pricing are ` +
      `rendered from the template, not generated.`,
    );
  }

  const parts: string[] = [];

  parts.push("# The salesperson's notes\n");
  parts.push(renderIntake(input.intake));

  if (input.materialSummaries.length > 0) {
    // Framed as REQUIRED INPUT, not optional reference.
    //
    // This block used to say "use anything relevant", which is permission
    // rather than instruction — and the model read it as material it could
    // ignore, producing proposals that cited nothing the client had sent. The
    // documents are usually where the specifics live: named systems, volumes,
    // constraints, the things that make a proposal read as written for this
    // client rather than assembled from a form.
    parts.push(
      `
# What the client sent us (${input.materialSummaries.length} document${
        input.materialSummaries.length === 1 ? "" : "s"
      })
`,
    );
    parts.push(
      "These are summaries of documents the client actually provided. They are " +
        "source material for this section, not background reading.\n\n" +
        "Use the specifics in them: named systems, volumes, team sizes, " +
        "constraints, anything concrete. A proposal that could have been " +
        "written without ever opening these documents has wasted them, and " +
        "the client will notice you did not engage with what they sent.\n\n" +
        "One exception, and it is absolute: a FIGURE OR DATE appearing only " +
        "here and not in the salesperson’s notes above is NOT " +
        "authorised for the proposal. Refer to it in words if you must, " +
        "never as a number.\n",
    );
    for (const material of input.materialSummaries) {
      parts.push(`## ${material.filename}\n\n${material.summary}\n`);
    }
  }

  if (input.precedingSections.length > 0) {
    parts.push("\n# Sections already written\n");
    parts.push(
      "These come before yours in the finished document. Stay consistent with " +
      "them and do not repeat them.\n",
    );
    for (const section of input.precedingSections) {
      parts.push(`## ${section.title}\n\n${section.content}\n`);
    }
  }

  parts.push("\n# Your task\n");
  parts.push(brief.instruction);
  parts.push(`\nAim for roughly ${brief.target} words.`);

  // The salesperson's own instruction, last and closest to the task.
  //
  // Placed after the brief because it is the more specific of the two: the
  // brief says what the section is for in general, this says what THIS
  // rewrite is for. Where they conflict, the person asking wins — they are
  // looking at the draft and the brief is not.
  if (input.userInstruction) {
    if (input.currentContent) {
      parts.push(
        "\n# The current text you are replacing\n",
        input.currentContent,
      );
    }

    parts.push(
      "\n# What the salesperson has asked you to change\n",
      input.userInstruction,
      "\nThis is the specific reason you are rewriting. Do what they " +
        "asked, and change nothing else that was already working — a rewrite " +
        "that fixes the requested thing and quietly rephrases three others is " +
        "worse than the original, because now everything needs re-reading.",
      "\nThe rules above still hold. If they ask for a figure or a date " +
        "that is not in the notes, write around it rather than inventing one.",
    );
  }

  if (input.rejectionFeedback) {
    // The retry has to know what went wrong, or it is just a second roll of the
    // same dice.
    parts.push(
      `\n# Your previous attempt was rejected\n\n${input.rejectionFeedback}\n\n` +
      `Write the section again without those values. If you need to refer to ` +
      `a cost or a timeframe, refer to it in words without stating a figure ` +
      `— the proposal states them in their own sections.`,
    );
  }

  return parts.join("\n");
}

/**
 * The intake as labelled fields, with gaps stated explicitly.
 *
 * "Not provided" rather than an omitted line, because a missing field the model
 * cannot see is a field it will cheerfully invent. Naming the gap is what makes
 * writing around it possible.
 */
function renderIntake(intake: Partial<IntakeFields>): string {
  const lines: string[] = [];

  for (const [field, label] of Object.entries(INTAKE_FIELD_LABELS) as Array<
    [keyof IntakeFields, string]
  >) {
    const value = (intake[field] ?? "").trim();
    lines.push(
      value === ""
        ? `**${label}:** _Not provided — write around this. Do not invent it._`
        : `**${label}:** ${value}`,
    );
  }

  return lines.join("\n");
}
