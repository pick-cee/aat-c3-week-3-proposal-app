"use server";

import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity";
import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import type { IntakeFields, Proposal, SupportingMaterial } from "@/lib/db/types";
import { RuleViolation } from "@/lib/errors";
import { extractIntake } from "@/lib/extract/intake";
import { assertAuthor, assertEditable, assertNotApproverEditing } from "@/lib/guards";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { SECTION_DEFINITIONS } from "@/lib/sections";
import { generateShareToken } from "@/lib/share-token";
import { renderTemplateSection } from "@/lib/render/template-sections";

export async function startFromNotes(): Promise<string> {
  const actor = await requireProfile();
  assertNotApproverEditing(actor);

  const db = await getServerClient();

  const { data, error } = await db
    .from("proposals")
    .insert({
      status: "draft",
      version: 1,
      author_id: actor.id,
      author_name: actor.full_name,
      // Pre-filled from the profile: the salesperson running the call is
      // almost always the one typing, and it is a Mark-tier field they can
      // change on the confirm screen.
      salesperson_name: actor.full_name,
      share_token: generateShareToken(),
      field_gaps: [],
      field_provenance: {},
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Could not start a proposal: ${error?.message}`);
  }

  const proposal = data as Proposal;

  const { error: sectionsError } = await db.from("proposal_sections").insert(
    SECTION_DEFINITIONS.map((definition) => ({
      proposal_id: proposal.id,
      section_key: definition.key,
      title: definition.title,
      position: definition.position,
      source: definition.source,
      content:
        definition.source === "template"
          ? renderTemplateSection(definition, {})
          : null,
    })),
  );

  if (sectionsError) {
    throw new Error(
      `The proposal was created but its sections were not: ${sectionsError.message}`,
    );
  }

  await logActivity({
    proposalId: proposal.id,
    actorName: actor.full_name,
    event: "created",
    detail: "Started from call notes.",
  });

  return proposal.id;
}

export interface ExtractionOutcome {
  ok: boolean;
  /** Plain-language cause when extraction did not run or did not produce anything. */
  message?: string;
  /** Fields extraction proposed but could not substantiate. */
  dropped?: Array<{ field: string; reason: string }>;
}

/**
 * Reads the notes and any summarized materials into proposed intake values.
 *
 * Saves the proposals onto the draft so the confirm screen can render them —
 * they are values in the form, not committed facts. Nothing is fixed until the
 * salesperson confirms, and `field_provenance.confirmed` stays false until then.
 */
export async function extractFromNotes(
  proposalId: string,
  notes: string,
): Promise<ExtractionOutcome> {
  const actor = await requireProfile();
  assertNotApproverEditing(actor);

  const db = await getServerClient();

  const { data } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (!data) throw new RuleViolation("Proposal not found.", "not_found");

  const proposal = data as Proposal;
  assertAuthor(proposal, actor);
  assertEditable(proposal);

  // Extraction is a Sonnet call reachable from a public one-click demo, so it
  // is bounded exactly like every other model call. See DESIGN.md section 11.
  const limit = await checkRateLimit();
  if (!limit.allowed) {
    await logActivity({
      proposalId,
      actorName: actor.full_name,
      event: "rate_limited",
      detail: "Intake extraction was blocked by the hourly limit.",
    });

    return { ok: false, message: rateLimitMessage(limit) };
  }

  const { data: materialRows } = await db
    .from("supporting_materials")
    .select("*")
    .eq("proposal_id", proposalId)
    .eq("summarized", true);

  const materials = (materialRows ?? []) as SupportingMaterial[];

  // The notes are stored whatever happens next. A failed extraction must not
  // lose what the salesperson typed.
  await db
    .from("proposals")
    .update({ raw_notes: notes.trim() || null })
    .eq("id", proposalId);

  try {
    const result = await extractIntake({
      notes,
      materialSummaries: materials
        .filter((m) => m.summary)
        .map((m) => ({ filename: m.filename, summary: m.summary! })),
    });

    const values: Partial<IntakeFields> = {};
    const provenance: Record<string, { source: string; confirmed: boolean }> = {};

    for (const [field, extracted] of Object.entries(result.fields)) {
      values[field as keyof IntakeFields] = extracted.value;
      // `confirmed: false` — the salesperson has not seen these yet.
      provenance[field] = { source: extracted.source, confirmed: false };
    }

    await db
      .from("proposals")
      .update({ ...values, field_provenance: provenance })
      .eq("id", proposalId);

    await logActivity({
      proposalId,
      actorName: actor.full_name,
      event: "intake_extracted",
      detail:
        `Proposed ${Object.keys(result.fields).length} of 11 fields from the notes` +
        (result.dropped.length > 0
          ? `; dropped ${result.dropped.length} that could not be traced to the source.`
          : "."),
      modelUsed: result.usage.modelUsed,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });

    return {
      ok: true,
      dropped: result.dropped.map((d) => ({ field: d.field, reason: d.reason })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await logActivity({
      proposalId,
      actorName: actor.full_name,
      event: "generation_failed",
      detail: `Intake extraction failed: ${message}`,
    });

    // The notes are saved and the draft exists; the salesperson can retry or
    // fill the form in by hand. Nothing is lost.
    return { ok: false, message };
  }
}

/** Abandons an empty draft, so a cancelled notes screen leaves no litter. */
export async function discardIfEmpty(proposalId: string): Promise<void> {
  const actor = await requireProfile();
  const db = await getServerClient();

  const { data } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (!data) return;

  const proposal = data as Proposal;
  if (proposal.author_id !== actor.id) return;
  if (proposal.status !== "draft") return;

  // Only if genuinely untouched — never delete work.
  const hasContent =
    proposal.raw_notes ||
    proposal.client_name ||
    proposal.company_name ||
    proposal.client_needs_summary;

  if (hasContent) return;

  const { count } = await db
    .from("supporting_materials")
    .select("id", { count: "exact", head: true })
    .eq("proposal_id", proposalId);

  if ((count ?? 0) > 0) return;

  await db.from("proposals").delete().eq("id", proposalId);
  redirect("/queue");
}
