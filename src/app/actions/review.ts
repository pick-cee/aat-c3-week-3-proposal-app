"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity";
import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import type {
  Proposal,
  ProposalSection,
  SectionKey,
  SupportingMaterial,
} from "@/lib/db/types";
import { RuleViolation } from "@/lib/errors";
import {
  assertAuthor,
  assertCanApprove,
  assertEditable,
  assertForkable,
} from "@/lib/guards";
import { assessReadiness } from "@/lib/policy/fields";
import { notifyApprovers, notifyAuthorOfDecision } from "@/lib/email/notify";
import { placeholderWarning } from "@/lib/policy/placeholders";
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

  // Recorded, not blocked. Sending with a placeholder is sometimes the right
  // call; doing it without anyone noticing is not.
  const placeholders = placeholderWarning(sections);

  await logActivity({
    proposalId,
    actorName: actor.full_name,
    event: "submitted",
    detail: [
      "Submitted for review.",
      staleCount > 0
        ? `${staleCount} section(s) marked out of date.`
        : null,
      placeholders,
    ]
      .filter(Boolean)
      .join(" "),
  });

  // Before the redirect, which throws. Awaited rather than fired and forgotten
  // so a serverless function is not torn down mid-send; `notify` swallows its
  // own failures, so this cannot fail the submission.
  await notifyApprovers(proposal, actor.full_name);

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

  // The salesperson is the one who has to act on this — sending belongs to
  // them by design, so an approved proposal waits for a step they may not know
  // is theirs. Before the redirect, which throws.
  await notifyAuthorOfDecision(
    proposal,
    "approved",
    actor.full_name,
    note?.trim() || null,
  );

  revalidatePath(`/proposals/${proposalId}`);
  redirect("/queue");
}
/**
 * Sends a proposal back with notes.
 *
 * Comments are per SECTION, plus an optional overall note for anything that is
 * not about one section. The approver knows which section they object to at the
 * moment they object to it, and a single free-text note forced them to describe
 * the location in prose — then forced the salesperson to find it again by
 * reading.
 *
 * `changes_requested` is a resting state, not a transition: the proposal sits
 * there displaying these notes, and returns to `draft` on the salesperson's
 * first edit.
 */
export async function requestChanges(
  proposalId: string,
  note: string,
  sectionNotes: Array<{ sectionKey: SectionKey; note: string }> = [],
): Promise<void> {
  const actor = await requireProfile();

  const trimmedOverall = note.trim();
  const comments = sectionNotes
    .map((c) => ({ sectionKey: c.sectionKey, note: c.note.trim() }))
    .filter((c) => c.note !== "");

  // At least one of the two. "Rejected" with no reason sends the salesperson
  // back to guess, which is the failure this whole screen exists to prevent.
  if (trimmedOverall === "" && comments.length === 0) {
    throw new RuleViolation(
      "Say what needs to change. Add a note on the sections that need work, " +
        "or an overall note — a rejection without a reason is not something " +
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

  // The decision row first, so the comments have something to hang off. If the
  // comment insert then fails, the decision still stands and is visible —
  // better than a proposal sent back with the reason lost.
  const { data: approvalRow, error } = await db
    .from("approvals")
    .insert({
      proposal_id: proposalId,
      approver_id: actor.id,
      approver_name: actor.full_name,
      decision: "changes_requested",
      note: trimmedOverall || null,
    })
    .select()
    .single();

  if (error || !approvalRow) {
    throw new Error(`Could not record the decision: ${error?.message}`);
  }

  if (comments.length > 0) {
    const { error: commentError } = await db.from("approval_comments").insert(
      comments.map((c) => ({
        approval_id: approvalRow.id,
        section_key: c.sectionKey,
        note: c.note,
      })),
    );

    if (commentError) {
      // The decision is already recorded, so this is reported rather than
      // thrown: losing the section notes is bad, losing the decision as well
      // would be worse.
      console.error(
        `[review] section notes not saved for ${proposalId}: ${commentError.message}`,
      );
    }
  }

  await db
    .from("proposals")
    .update({ status: "changes_requested" })
    .eq("id", proposalId);

  await logActivity({
    proposalId,
    actorName: actor.full_name,
    event: "changes_requested",
    detail:
      comments.length > 0
        ? `${comments.length} section${comments.length === 1 ? "" : "s"} need work` +
          (trimmedOverall ? `. ${trimmedOverall}` : ".")
        : trimmedOverall,
  });

  // Being blocked without knowing it is the worst seat in this workflow: the
  // proposal sits in `changes_requested` displaying notes nobody has read.
  // Before the redirect, which throws.
  await notifyAuthorOfDecision(
    proposal,
    "changes_requested",
    actor.full_name,
    trimmedOverall || null,
    comments.length,
  );

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

  // Forking twice from the same parent produces two versions numbered N+1 that
  // both claim to continue it, and the chain stops being a chain.
  //
  // This is not a double-click race — it is the ordinary way the mistake
  // happens. A salesperson forks v1 to v2, works on v2, then later opens v1
  // (it is still on the queue, and it is the version they know) and presses
  // the same button expecting v3. Nothing about v1 said it had already been
  // continued, so the button did exactly what it said and made a second v2.
  //
  // The fix is to satisfy the intent rather than refuse it: the salesperson
  // wants to edit this proposal's current work, so send them to the version
  // that already carries it. Forking is meant to be free and unremarkable, and
  // an error message here would make it feel dangerous.
  const { data: existingChild } = await db
    .from("proposals")
    .select("id")
    .eq("parent_id", parent.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingChild) {
    redirect(`/proposals/${existingChild.id}`);
  }

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
