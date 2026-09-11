"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import {
  INTAKE_FIELD_KEYS,
  type IntakeFields,
  type Proposal,
} from "@/lib/db/types";
import { RuleViolation } from "@/lib/errors";
import {
  assertAuthor,
  assertEditable,
  assertNotApproverEditing,
  editableStatusAfter,
} from "@/lib/guards";
import { intakeDrift, mergeStaleReasons } from "@/lib/policy/staleness";
import { SECTION_DEFINITIONS } from "@/lib/sections";
import { generateShareToken } from "@/lib/share-token";
import { logActivity } from "@/lib/activity";
import { renderTemplateSection } from "@/lib/render/template-sections";

/**
 * Which provenance entries survive an intake write.
 *
 * A source phrase that no longer supports the value in the field is worse than
 * none — the form would show a quotation appearing to justify a number nobody
 * extracted. So a changed value becomes hand-typed, decided by comparing what
 * was submitted against what extraction proposed rather than trusting the
 * client to report an edit.
 */
function provenanceAfterEdit(
  existing: Proposal["field_provenance"],
  before: Partial<IntakeFields>,
  after: IntakeFields,
  confirming: boolean,
): Record<string, { source: string; confirmed: boolean; reason?: string }> {
  const kept: Record<
    string,
    { source: string; confirmed: boolean; reason?: string }
  > = {};

  for (const [field, entry] of Object.entries(existing ?? {})) {
    const key = field as keyof IntakeFields;
    const wasProposed = (before[key] ?? "").trim();
    const nowSubmitted = (after[key] ?? "").trim();

    // An entry carrying a `reason` explains an EMPTY field, so it survives
    // precisely while the field stays empty — the opposite condition to the
    // one below. Filling the field in answers the question the reason asked,
    // so the explanation goes.
    if (entry.reason) {
      if (nowSubmitted === "") {
        kept[field] = {
          source: entry.source,
          reason: entry.reason,
          confirmed: confirming || entry.confirmed,
        };
      }
      continue;
    }

    if (nowSubmitted === "" || nowSubmitted !== wasProposed) continue;

    kept[field] = {
      source: entry.source,
      // Confirming is what makes an extracted value real. Later edits to other
      // fields must not silently un-confirm what was already accepted.
      confirmed: confirming || entry.confirmed,
    };
  }

  return kept;
}

/** Reads the intake fields out of a form, normalizing blanks to null. */
function intakeFromForm(formData: FormData): IntakeFields {
  const intake = {} as IntakeFields;

  for (const field of INTAKE_FIELD_KEYS) {
    const raw = formData.get(field);
    const value = typeof raw === "string" ? raw.trim() : "";
    intake[field] = value === "" ? null : value;
  }

  return intake;
}

/**
 * Creates a proposal in `draft` with its six section rows.
 *
 * Sections are created empty up front rather than on first generation so the
 * document has a shape immediately: the editor shows six cards, the two
 * template ones already rendered from intake, and the four generated ones
 * waiting. A proposal that looks empty until you generate hides what it is
 * going to be.
 */
export async function createProposal(formData: FormData) {
  const actor = await requireProfile();
  assertNotApproverEditing(actor);

  const intake = intakeFromForm(formData);
  const db = await getServerClient();

  const { data: proposal, error } = await db
    .from("proposals")
    .insert({
      ...intake,
      status: "draft",
      version: 1,
      author_id: actor.id,
      author_name: actor.full_name,
      share_token: generateShareToken(),
      field_gaps: [],
    })
    .select()
    .single();

  if (error || !proposal) {
    throw new Error(`Could not create the proposal: ${error?.message}`);
  }

  const created = proposal as Proposal;

  const { error: sectionsError } = await db.from("proposal_sections").insert(
    SECTION_DEFINITIONS.map((definition) => ({
      proposal_id: created.id,
      section_key: definition.key,
      title: definition.title,
      position: definition.position,
      source: definition.source,
      // Template sections render immediately — they need no model.
      content:
        definition.source === "template"
          ? renderTemplateSection(definition, intake)
          : null,
    })),
  );

  if (sectionsError) {
    throw new Error(
      `The proposal was created but its sections were not: ${sectionsError.message}`,
    );
  }

  await logActivity({
    proposalId: created.id,
    actorName: actor.full_name,
    event: "created",
    detail: `Intake captured for ${created.client_name ?? "an unnamed client"}.`,
  });

  redirect(`/proposals/${created.id}`);
}

/**
 * Updates intake on an existing draft, and marks affected sections stale.
 *
 * This is the back door the commercial-terms check cannot see: it runs at
 * generation time, and intake can change afterwards. Every generated section's
 * snapshot is diffed against the new values here, so a section written when the
 * client was "Acme" says so once it becomes "Acme Corp Ltd".
 */
/**
 * Deletes a draft the salesperson has decided against.
 *
 * Distinct from `discardIfEmpty`, which silently refuses once anything has been
 * typed — right for an accidental start, useless for a proposal someone worked
 * on and then lost the deal for. That one is a tidy-up; this is a decision, so
 * it removes real work and the UI asks before calling it.
 *
 * Only a `draft` can go. Once submitted, the proposal is part of a record
 * someone else participated in: an approver has read it, or a client has been
 * sent it, and deleting it would erase their side of that too. Rule 3 already
 * says content is editable only in `draft`; deletion is the strongest edit
 * there is.
 */
export async function deleteDraft(proposalId: string): Promise<void> {
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

  if (proposal.status !== "draft" && proposal.status !== "changes_requested") {
    throw new RuleViolation(
      "Only a draft can be deleted. This one has been submitted, so it is " +
      "part of a record someone else has already acted on.",
      "not_draft",
    );
  }

  // A version other people built on must not vanish underneath them.
  const { data: child } = await db
    .from("proposals")
    .select("id, version")
    .eq("parent_id", proposalId)
    .maybeSingle();

  if (child) {
    throw new RuleViolation(
      `Version ${child.version} was created from this one, so deleting it ` +
      "would break the chain. Delete that version first.",
      "has_successor",
    );
  }

  /*
    Storage bytes are reference-counted, exactly as `deleteMaterial` does it.

    A fork RE-LINKS materials rather than copying the file, so several versions
    can point at one object. Removing every file this draft references would
    silently gut an approved — possibly already sent — sibling version, and
    nothing would report it until someone opened that version and found the
    document missing.

    The rows go either way: `supporting_materials` cascades from `proposals`.
    Only the bytes need this check.
  */
  const { data: materials } = await db
    .from("supporting_materials")
    .select("id, storage_path")
    .eq("proposal_id", proposalId);

  for (const material of materials ?? []) {
    if (!material.storage_path) continue;

    const { count } = await db
      .from("supporting_materials")
      .select("id", { count: "exact", head: true })
      .eq("storage_path", material.storage_path)
      .neq("proposal_id", proposalId);

    if ((count ?? 0) === 0) {
      await db.storage.from("materials").remove([material.storage_path]);
    }
  }

  // `approvals` and `deliveries` reference proposals WITHOUT cascade, by
  // design — they are permanent records. A `changes_requested` draft has an
  // approval row, so it must go first or the delete is refused. Nothing is
  // lost that outlives the proposal it describes.
  await db.from("approvals").delete().eq("proposal_id", proposalId);

  const { error } = await db.from("proposals").delete().eq("id", proposalId);

  if (error) {
    throw new Error(`Could not delete the draft: ${error.message}`);
  }

  revalidatePath("/queue");
  redirect("/queue");
}

export async function updateIntake(proposalId: string, formData: FormData) {
  const actor = await requireProfile();
  assertNotApproverEditing(actor);

  const db = await getServerClient();

  const { data: existing } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (!existing) throw new RuleViolation("Proposal not found.", "not_found");

  const proposal = existing as Proposal;

  assertEditable(proposal);

  // `changes_requested` returns to draft on the first edit (rule 6). Uses the
  // shared helper so all five edit paths make the same transition.
  const nextStatus = editableStatusAfter(proposal);
  if (nextStatus) {
    await db.from("proposals").update({ status: nextStatus }).eq("id", proposalId);
    proposal.status = nextStatus;
  }

  const intake = intakeFromForm(formData);

  const { error } = await db
    .from("proposals")
    .update({
      ...intake,
      // An edited field loses its source phrase — see `provenanceAfterEdit`.
      field_provenance: provenanceAfterEdit(
        proposal.field_provenance,
        proposal,
        intake,
        false,
      ),
    })
    .eq("id", proposalId);

  if (error) {
    throw new Error(`Could not save the intake: ${error.message}`);
  }

  await markStaleAfterIntakeChange(proposalId, intake, actor.full_name);
  await rerenderTemplateSections(proposalId, intake);

  await logActivity({
    proposalId,
    actorName: actor.full_name,
    event: "intake_edited",
    detail: "Intake updated.",
  });
}

/**
 * The confirm screen's submit (DESIGN.md section 5).
 *
 * The same write as `updateIntake`, with one difference that matters: it
 * records that a human looked at these values and accepted them. That
 * acceptance is what the commercial-terms guarantee now rests on — every
 * commercial term in the finished document was confirmed by someone who saw
 * where it came from.
 *
 * It shares `intakeFromForm` and `provenanceAfterEdit` with `updateIntake`
 * rather than reimplementing them, so the two paths cannot drift.
 */
export async function confirmIntake(proposalId: string, formData: FormData) {
  const actor = await requireProfile();
  assertNotApproverEditing(actor);

  const db = await getServerClient();

  const { data: existing } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (!existing) throw new RuleViolation("Proposal not found.", "not_found");

  const proposal = existing as Proposal;
  assertEditable(proposal);

  // The fifth edit path: the editor links here to change intake, so a
  // rejection acted on from this screen returns to draft too.
  const nextStatus = editableStatusAfter(proposal);
  if (nextStatus) {
    await db.from("proposals").update({ status: nextStatus }).eq("id", proposalId);
  }

  const intake = intakeFromForm(formData);
  const provenance = provenanceAfterEdit(
    proposal.field_provenance,
    proposal,
    intake,
    true,
  );

  const { error } = await db
    .from("proposals")
    .update({ ...intake, field_provenance: provenance })
    .eq("id", proposalId);

  if (error) {
    throw new Error(`Could not save the intake: ${error.message}`);
  }

  // This screen is now also how intake is EDITED after generation — the editor
  // links here rather than carrying a second copy of the form. So a change made
  // here has to mark sections stale exactly as `updateIntake` does, or drift
  // would go unrecorded on whichever path the salesperson happened to take.
  await markStaleAfterIntakeChange(proposalId, intake, actor.full_name);
  await rerenderTemplateSections(proposalId, intake);

  const confirmedCount = Object.keys(provenance).length;
  const proposedCount = Object.keys(proposal.field_provenance ?? {}).length;

  await logActivity({
    proposalId,
    actorName: actor.full_name,
    event: "intake_confirmed",
    detail:
      proposedCount === 0
        ? "Intake entered by hand and confirmed."
        : `Confirmed ${confirmedCount} of ${proposedCount} extracted values` +
          (proposedCount > confirmedCount
            ? `; ${proposedCount - confirmedCount} were edited or cleared.`
            : " unchanged."),
  });

  redirect(`/proposals/${proposalId}`);
}

/**
 * Diffs each generated section's snapshot against the new intake and records
 * what changed. Costs no model call — only the fix does, and that is the
 * salesperson's decision.
 */
async function markStaleAfterIntakeChange(
  proposalId: string,
  intake: IntakeFields,
  actorName: string,
) {
  const db = await getServerClient();

  const { data: sections } = await db
    .from("proposal_sections")
    .select("*")
    .eq("proposal_id", proposalId)
    .eq("source", "generated");

  if (!sections?.length) return;

  const changedTitles: string[] = [];

  for (const section of sections) {
    const drift = intakeDrift(section.generated_from, intake);
    if (drift.length === 0) continue;

    const merged = mergeStaleReasons(section.stale_fields ?? [], drift);

    await db
      .from("proposal_sections")
      .update({ stale_fields: merged })
      .eq("id", section.id);

    changedTitles.push(section.title);
  }

  if (changedTitles.length > 0) {
    await logActivity({
      proposalId,
      actorName,
      event: "sections_marked_stale",
      detail: `Intake changed after generation: ${changedTitles.join(", ")} ${
        changedTitles.length === 1 ? "is" : "are"
      } now out of date.`,
    });
  }
}

/**
 * Template sections re-render from intake automatically — they cannot be stale,
 * because there is no model output to go out of date. Not a user-facing
 * operation and it costs nothing.
 */
async function rerenderTemplateSections(
  proposalId: string,
  intake: IntakeFields,
) {
  const db = await getServerClient();

  for (const definition of SECTION_DEFINITIONS) {
    if (definition.source !== "template") continue;

    await db
      .from("proposal_sections")
      .update({ content: renderTemplateSection(definition, intake) })
      .eq("proposal_id", proposalId)
      .eq("section_key", definition.key);
  }
}

