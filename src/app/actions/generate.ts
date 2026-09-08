"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity";
import { requireProfile } from "@/lib/auth";
import { MAX_REGENERATIONS_PER_SECTION } from "@/lib/constants";
import { getServerClient } from "@/lib/db/server";
import type {
  Profile,
  Proposal,
  ProposalSection,
  SectionKey,
  SupportingMaterial,
} from "@/lib/db/types";
import { RuleViolation } from "@/lib/errors";
import { assertAuthor, assertEditable, assertNotApproverEditing } from "@/lib/guards";
import { generateSection, type GenerationAttempt } from "@/lib/generate/section";
import { assessReadiness, findGaps } from "@/lib/policy/fields";
import {
  mergeStaleReasons,
  regenerationStaleReason,
  snapshotIntake,
} from "@/lib/policy/staleness";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { GENERATED_SECTIONS, generatedSectionsAfter } from "@/lib/sections";


export interface GenerationReport {
  ok: boolean;
  /** Per-section outcome, for the UI to show what happened to each. */
  results: Array<{ sectionKey: SectionKey; ok: boolean; message?: string }>;
  /** Set when the whole run was refused before any call was made. */
  blockedReason?: string;
}

/**
 * Generates all four written sections, in order.
 *
 * In `position` order because each call receives the sections before it — that
 * is what stops Deliverables promising something Proposed Solution never
 * mentioned. It also means input tokens grow with position, which is the
 * deliberate trade: a contradiction between sections is a defect a client sees.
 */
export async function generateAllSections(
  proposalId: string,
  confirmedWarnings = false,
): Promise<GenerationReport> {
  const { actor, proposal } = await loadForGeneration(proposalId);

  const readiness = assessReadiness(proposal, confirmedWarnings);
  if (!readiness.canGenerate) {
    return { ok: false, results: [], blockedReason: readiness.reason! };
  }

  // Recorded at generation time, so `field_gaps` says what was missing THEN.
  await (await getServerClient())
    .from("proposals")
    .update({ field_gaps: findGaps(proposal) })
    .eq("id", proposalId);

  const results: GenerationReport["results"] = [];

  for (const definition of GENERATED_SECTIONS) {
    const outcome = await runSectionGeneration(
      proposal,
      definition.key,
      actor,
      false,
    );

    results.push({
      sectionKey: definition.key,
      ok: outcome.ok,
      message: outcome.message,
    });

    // A rate-limit stop applies to everything after it too — continuing would
    // burn four failed attempts against a limit that is already exhausted.
    if (outcome.stopRun) break;
  }

  revalidatePath(`/proposals/${proposalId}`);
  return { ok: results.every((r) => r.ok), results };
}

/**
 * Generates ONE section as part of a full run.
 *
 * Exists so the editor can drive generation section by section from the
 * client, showing each card fill in as its call returns rather than freezing
 * for twenty seconds and revealing everything at once. The sequencing —
 * `position` order, each call receiving the sections before it — is the
 * caller's responsibility, and `GENERATED_SECTION_KEYS` is the order to use.
 *
 * Doing this from the client rather than streaming from one action keeps each
 * call a normal server action: no SSE plumbing, and a failure part-way through
 * leaves every earlier section already saved.
 */
export async function generateOneSection(
  proposalId: string,
  sectionKey: SectionKey,
  confirmedWarnings = false,
): Promise<{ ok: boolean; message?: string; stopRun?: boolean }> {
  const { actor, proposal } = await loadForGeneration(proposalId);

  const readiness = assessReadiness(proposal, confirmedWarnings);
  if (!readiness.canGenerate) {
    return { ok: false, message: readiness.reason!, stopRun: true };
  }

  const outcome = await runSectionGeneration(proposal, sectionKey, actor, false);
  revalidatePath(`/proposals/${proposalId}`);

  return outcome;
}

/** Records which fields were missing at generation time. Called once per run. */
export async function recordGenerationGaps(proposalId: string): Promise<void> {
  const { proposal } = await loadForGeneration(proposalId);
  const db = await getServerClient();

  await db
    .from("proposals")
    .update({ field_gaps: findGaps(proposal) })
    .eq("id", proposalId);
}

/**
 * Regenerates one section, leaving the rest untouched.
 *
 * The sections that follow are MARKED, not regenerated: cascading would turn
 * one intentional regeneration into four calls and re-roll text the human may
 * have already edited.
 */
export async function regenerateSection(
  proposalId: string,
  sectionKey: SectionKey,
): Promise<{ ok: boolean; message?: string }> {
  const { actor, proposal } = await loadForGeneration(proposalId);

  // The Block tier gates EVERY path to a model call, not just the full run.
  // Without this, a page showing "Generation is disabled" still had a working
  // Regenerate button on every section — the gate was on one route and the
  // other went around it.
  //
  // `confirmedWarnings` is true because a section that already exists was
  // generated under a confirmation the salesperson has given once; re-asking on
  // every regeneration would be nagging, and the Warn tier has never blocked.
  const readiness = assessReadiness(proposal, true);
  if (!readiness.canGenerate) {
    return { ok: false, message: readiness.reason! };
  }

  const outcome = await runSectionGeneration(proposal, sectionKey, actor, true);

  if (outcome.ok) {
    await markFollowingSectionsStale(proposalId, sectionKey, actor);
  }

  revalidatePath(`/proposals/${proposalId}`);
  return { ok: outcome.ok, message: outcome.message };
}

async function loadForGeneration(
  proposalId: string,
): Promise<{ actor: Profile; proposal: Proposal }> {
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

  return { actor, proposal };
}

interface SectionOutcome {
  ok: boolean;
  message?: string;
  /** True when the rest of a multi-section run should be abandoned. */
  stopRun?: boolean;
}

async function runSectionGeneration(
  proposal: Proposal,
  sectionKey: SectionKey,
  actor: Profile,
  isRegeneration: boolean,
): Promise<SectionOutcome> {
  const db = await getServerClient();

  const { data: sectionRow } = await db
    .from("proposal_sections")
    .select("*")
    .eq("proposal_id", proposal.id)
    .eq("section_key", sectionKey)
    .single();

  if (!sectionRow) {
    return { ok: false, message: `Section "${sectionKey}" does not exist.` };
  }

  const section = sectionRow as ProposalSection;

  if (section.source === "template") {
    // Should be unreachable: the UI shows no regenerate control for these.
    return {
      ok: false,
      message:
        "This section is rendered from the intake, not generated. Edit the " +
        "intake field instead.",
    };
  }

  if (
    isRegeneration &&
    section.regenerated_count >= MAX_REGENERATIONS_PER_SECTION
  ) {
    return {
      ok: false,
      message:
        `This section has been regenerated ${MAX_REGENERATIONS_PER_SECTION} ` +
        `times. Past that the prompt is usually the problem rather than the ` +
        `sample — try editing the intake, or edit the text directly.`,
    };
  }

  const limit = await checkRateLimit();
  if (!limit.allowed) {
    await logActivity({
      proposalId: proposal.id,
      actorName: actor.full_name,
      event: "rate_limited",
      detail: `Generation of "${section.title}" was blocked by the hourly limit.`,
    });
    return { ok: false, message: rateLimitMessage(limit), stopRun: true };
  }

  const [materials, preceding] = await Promise.all([
    loadMaterialSummaries(proposal.id),
    loadPrecedingSections(proposal.id, sectionKey),
  ]);

  const outcome = await generateSection({
    sectionKey,
    intake: proposal,
    materialSummaries: materials.summaries,
    precedingSections: preceding,
  });

  // Every attempt is logged, including the discarded ones. They cost money and
  // the running total in the editor has to reflect that.
  await logAttempts(proposal.id, actor, section.title, outcome.attempts);

  if (outcome.status === "failed") {
    await logActivity({
      proposalId: proposal.id,
      actorName: actor.full_name,
      event: "generation_failed",
      detail: `${section.title}: ${outcome.reason}`,
    });

    // The section keeps its previous content. A failed regeneration must never
    // blank a section that was fine.
    return { ok: false, message: outcome.reason };
  }

  await db
    .from("proposal_sections")
    .update({
      content: outcome.content,
      model_used: outcome.usage.modelUsed,
      input_tokens: outcome.usage.inputTokens,
      output_tokens: outcome.usage.outputTokens,
      last_generated_at: new Date().toISOString(),
      generated_from: snapshotIntake(proposal),
      stale_fields: [],
      edited_by_human: false,
      regenerated_count: isRegeneration
        ? section.regenerated_count + 1
        : section.regenerated_count,
    })
    .eq("id", section.id);

  // Which materials informed this section — section 7 promises a salesperson
  // can see what the model actually used.
  if (materials.ids.length > 0) {
    await db.from("section_materials").delete().eq("section_id", section.id);
    await db.from("section_materials").insert(
      materials.ids.map((materialId) => ({
        section_id: section.id,
        material_id: materialId,
      })),
    );
  }

  await logActivity({
    proposalId: proposal.id,
    actorName: actor.full_name,
    event: isRegeneration ? "regenerated" : "generated",
    detail:
      `${section.title}` +
      (outcome.warnings.length > 0
        ? ` — ${outcome.warnings.length} name warning(s) to check`
        : ""),
    modelUsed: outcome.usage.modelUsed,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
  });

  return {
    ok: true,
    message:
      outcome.warnings.length > 0
        ? outcome.warnings.map((w) => w.note).join(" ")
        : undefined,
  };
}

async function logAttempts(
  proposalId: string,
  actor: Profile,
  sectionTitle: string,
  attempts: GenerationAttempt[],
): Promise<void> {
  for (const attempt of attempts) {
    if (attempt.outcome === "accepted") continue; // logged by the caller

    await logActivity({
      proposalId,
      actorName: actor.full_name,
      event: "generation_rejected",
      detail: `${sectionTitle}: ${attempt.reason ?? "rejected"}`,
      modelUsed: attempt.usage.modelUsed,
      inputTokens: attempt.usage.inputTokens,
      outputTokens: attempt.usage.outputTokens,
    });
  }
}

async function loadMaterialSummaries(proposalId: string): Promise<{
  summaries: Array<{ filename: string; summary: string }>;
  ids: string[];
}> {
  const db = await getServerClient();

  // Only summarized materials reach generation. A file over the cap, unreadable
  // or empty is visible in the UI with its reason, but it has nothing to
  // contribute here.
  const { data } = await db
    .from("supporting_materials")
    .select("*")
    .eq("proposal_id", proposalId)
    .eq("summarized", true)
    .order("created_at", { ascending: true });

  const materials = (data ?? []) as SupportingMaterial[];

  return {
    summaries: materials
      .filter((m) => m.summary)
      .map((m) => ({ filename: m.filename, summary: m.summary! })),
    ids: materials.map((m) => m.id),
  };
}

async function loadPrecedingSections(
  proposalId: string,
  sectionKey: SectionKey,
): Promise<Array<{ title: string; content: string }>> {
  const db = await getServerClient();

  const { data } = await db
    .from("proposal_sections")
    .select("*")
    .eq("proposal_id", proposalId)
    .order("position", { ascending: true });

  const sections = (data ?? []) as ProposalSection[];
  const target = sections.find((s) => s.section_key === sectionKey);
  if (!target) return [];

  return sections
    .filter((s) => s.position < target.position && s.content)
    .map((s) => ({ title: s.title, content: s.content! }));
}

/**
 * A regenerated section makes the ones after it stale.
 *
 * They were written against a solution that no longer exists. Nothing in the
 * intake changed, which makes this drift LESS visible than the intake kind —
 * there is no edited field to notice — so it is recorded rather than prompted.
 */
async function markFollowingSectionsStale(
  proposalId: string,
  regeneratedKey: SectionKey,
  actor: Profile,
): Promise<void> {
  const following = generatedSectionsAfter(regeneratedKey);
  if (following.length === 0) return;

  const db = await getServerClient();
  const reason = regenerationStaleReason(regeneratedKey);
  const markedTitles: string[] = [];

  for (const definition of following) {
    const { data } = await db
      .from("proposal_sections")
      .select("*")
      .eq("proposal_id", proposalId)
      .eq("section_key", definition.key)
      .single();

    if (!data) continue;
    const section = data as ProposalSection;

    // Nothing written yet means nothing to go stale.
    if (!section.content) continue;

    await db
      .from("proposal_sections")
      .update({
        stale_fields: mergeStaleReasons(section.stale_fields ?? [], [reason]),
      })
      .eq("id", section.id);

    markedTitles.push(section.title);
  }

  if (markedTitles.length > 0) {
    await logActivity({
      proposalId,
      actorName: actor.full_name,
      event: "sections_marked_stale",
      detail: `${markedTitles.join(", ")} may no longer match the regenerated section.`,
    });
  }
}
