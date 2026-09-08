"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity";
import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import type { Proposal, ProposalSection, SupportingMaterial } from "@/lib/db/types";
import { RuleViolation } from "@/lib/errors";
import {
  assertAuthor,
  assertCanApprove,
  assertEditable,
  assertForkable,
} from "@/lib/guards";
import { assessReadiness } from "@/lib/policy/fields";
import { GENERATED_SECTIONS } from "@/lib/sections";

/** Submits a draft for review. */
export async function submitForReview(proposalId: string): Promise<void> {
  const actor = await requireProfile();
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

  // Blocking gaps still block: submitting an incomplete proposal would put the
  // approver in the position of catching what the intake policy already knows.
  const readiness = assessReadiness(proposal, true);
  if (!readiness.canGenerate) {
    throw new RuleViolation(readiness.reason!, "incomplete_intake");
  }

  const { data: sectionRows } = await db
    .from("proposal_sections")
    .select("*")
    .eq("proposal_id", proposalId);

  const sections = (sectionRows ?? []) as ProposalSection[];
  const ungenerated = GENERATED_SECTIONS.filter(
    (definition) =>
      !sections.find((s) => s.section_key === definition.key)?.content,
  );

  if (ungenerated.length > 0) {
    throw new RuleViolation(
      `${ungenerated.map((s) => s.title).join(", ")} ${ungenerated.length === 1 ? "has" : "have"
      } not been written yet. Generate the proposal before submitting it.`,
      "sections_missing",
    );
  }

  await db
    .from("proposals")
    .update({ status: "in_review" })
    .eq("id", proposalId);

  // Stale sections do not block submission — the salesperson may have judged
  // the change immaterial, and that is a call a human is entitled to make. It
  // is recorded so the approver sees the same thing.
  const staleCount = sections.filter(
    (s) => (s.stale_fields ?? []).length > 0,
  ).length;

  await logActivity({
    proposalId,
    actorName: actor.full_name,
    event: "submitted",
    detail:
      staleCount > 0
        ? `Submitted for review with ${staleCount} section(s) marked out of date.`
        : "Submitted for review.",
  });

  revalidatePath(`/proposals/${proposalId}`);
  redirect("/queue");
}

/** Approves a proposal. The approver's job ends here. */
export async function approveProposal(
  proposalId: string,
  note: string | null,
): Promise<void> {
  const actor = await requireProfile();
  const db = await getServerClient();

  const { data } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (!data) throw new RuleViolation("Proposal not found.", "not_found");

  const proposal = data as Proposal;
  assertCanApprove(proposal, actor);

  // The approval row is written FIRST. If the status update then fails, the
  // record of the decision still exists — better than a proposal marked
  // approved with no record of who approved it.
  const { error: approvalError } = await db.from("approvals").insert({
    proposal_id: proposalId,
    approver_id: actor.id,
    approver_name: actor.full_name,
    decision: "approved",
    note: note?.trim() || null,
  });

  if (approvalError) {
    throw new Error(`Could not record the approval: ${approvalError.message}`);
  }

  await db.from("proposals").update({ status: "approved" }).eq("id", proposalId);

  await logActivity({
    proposalId,
    actorName: actor.full_name,
    event: "approved",
    detail: note?.trim()
      ? `Approved: ${note.trim()}`
      : "Approved with no note.",
  });

  revalidatePath(`/proposals/${proposalId}`);
  redirect("/queue");
}
export async function requestChanges(
  proposalId: string,
  note: string,
): Promise<void> {
  const actor = await requireProfile();

  const trimmed = note.trim();
  if (trimmed === "") {
    // The note is the entire value of this action. "Rejected" with no reason
    // sends the salesperson back to guess.
    throw new RuleViolation(
      "Say what needs to change. A rejection without a reason is not something " +
      "the salesperson can act on.",
      "note_required",
    );
  }

  const db = await getServerClient();

  const { data } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (!data) throw new RuleViolation("Proposal not found.", "not_found");

  const proposal = data as Proposal;
  assertCanApprove(proposal, actor);

  const { error } = await db.from("approvals").insert({
    proposal_id: proposalId,
    approver_id: actor.id,
    approver_name: actor.full_name,
    decision: "changes_requested",
    note: trimmed,
  });

  if (error) {
    throw new Error(`Could not record the decision: ${error.message}`);
  }

  await db
    .from("proposals")
    .update({ status: "changes_requested" })
    .eq("id", proposalId);

  await logActivity({
    proposalId,
    actorName: actor.full_name,
    event: "changes_requested",
    detail: trimmed,
  });

  revalidatePath(`/proposals/${proposalId}`);
  redirect("/queue");
}

/**
 * Forks an approved proposal to version N+1.
 *
 * Implements the table in DESIGN.md section 2, "What a fork carries". The
 * property to protect is that a fork costs ZERO MODEL CALLS: if forking is
 * expensive, people will edit approved documents instead, and rule 2 becomes
 * the thing they route around.
 */
export async function forkProposal(proposalId: string): Promise<void> {
  const actor = await requireProfile();
  const db = await getServerClient();

  const { data } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (!data) throw new RuleViolation("Proposal not found.", "not_found");

  const parent = data as Proposal;
  assertForkable(parent, actor);

  const [{ data: sectionRows }, { data: materialRows }] = await Promise.all([
    db.from("proposal_sections").select("*").eq("proposal_id", proposalId),
    db.from("supporting_materials").select("*").eq("proposal_id", proposalId),
  ]);

  const sections = (sectionRows ?? []) as ProposalSection[];
  const materials = (materialRows ?? []) as SupportingMaterial[];

  const {
    id: _id,
    version: _version,
    parent_id: _parentId,
    status: _status,
    created_at: _createdAt,
    updated_at: _updatedAt,
    ...carried
  } = parent;

  const { data: forked, error } = await db
    .from("proposals")
    .insert({
      ...carried, // intake, field_gaps, author, AND share_token — inherited so
      // the link already in the client's inbox keeps working.
      version: parent.version + 1,
      parent_id: parent.id,
      status: "draft",
    })
    .select()
    .single();

  if (error || !forked) {
    throw new Error(`Could not create the new version: ${error?.message}`);
  }

  const child = forked as Proposal;

  // Sections are deep-copied, content and all: v2 opens as a readable document,
  // not an empty shell. `regenerated_count` resets — the cap guards against
  // thrashing one section, not a lifetime budget for a document.
  const sectionIdMap = new Map<string, string>();

  for (const section of sections) {
    const { data: copied } = await db
      .from("proposal_sections")
      .insert({
        proposal_id: child.id,
        section_key: section.section_key,
        title: section.title,
        position: section.position,
        source: section.source,
        content: section.content,
        generated_from: section.generated_from,
        model_used: section.model_used,
        input_tokens: section.input_tokens,
        output_tokens: section.output_tokens,
        edited_by_human: section.edited_by_human,
        last_generated_at: section.last_generated_at,
        stale_fields: section.stale_fields,
        regenerated_count: 0,
      })
      .select("id")
      .single();

    if (copied) sectionIdMap.set(section.id, copied.id);
  }

  // Materials are RE-LINKED, never re-summarized. A summary of an unchanged
  // file is an unchanged summary; re-running Haiku here would mean a one-word
  // typo fix costs ten model calls to produce ten identical summaries.
  const materialIdMap = new Map<string, string>();

  for (const material of materials) {
    const { data: copied } = await db
      .from("supporting_materials")
      .insert({
        proposal_id: child.id,
        filename: material.filename,
        storage_path: material.storage_path,
        mime_type: material.mime_type,
        size_bytes: material.size_bytes,
        extraction_status: material.extraction_status,
        extraction_note: material.extraction_note,
        extracted_text: material.extracted_text,
        summary: material.summary,
        summarized: material.summarized,
      })
      .select("id")
      .single();

    if (copied) materialIdMap.set(material.id, copied.id);
  }

  // Provenance survives the fork: which materials informed which section is
  // unchanged, so the links are re-pointed rather than dropped.
  const { data: links } = await db
    .from("section_materials")
    .select("*")
    .in("section_id", [...sectionIdMap.keys()]);

  const remapped = (links ?? [])
    .map((link) => ({
      section_id: sectionIdMap.get(link.section_id),
      material_id: materialIdMap.get(link.material_id),
    }))
    .filter(
      (link): link is { section_id: string; material_id: string } =>
        Boolean(link.section_id && link.material_id),
    );

  if (remapped.length > 0) {
    await db.from("section_materials").insert(remapped);
  }

  await logActivity({
    proposalId: child.id,
    actorName: actor.full_name,
    event: "version_forked",
    detail:
      `Version ${child.version} created from version ${parent.version}, which ` +
      `stays exactly as approved. No model calls were needed.`,
  });

  redirect(`/proposals/${child.id}`);
}
