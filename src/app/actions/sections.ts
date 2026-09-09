"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity";
import { requireProfile } from "@/lib/auth";
import { getServerClient } from "@/lib/db/server";
import type { Proposal, ProposalSection, SectionKey } from "@/lib/db/types";
import { RuleViolation } from "@/lib/errors";
import {
  assertAuthor,
  assertEditable,
  assertNotApproverEditing,
  editableStatusAfter,
} from "@/lib/guards";

/**
 * Editing a section by hand.
 *
 * The cheapest possible fix, and for most corrections the right one: a name
 * that should read "Northwind Logistics" rather than "Northwind" is a
 * five-second edit, and spending a Sonnet call to re-roll four paragraphs in
 * the hope of getting it costs money and loses everything else that was fine.
 *
 * `edited_by_human` is set so the card says so and a later reader knows this
 * text is not purely model output.
 */
export async function saveSectionContent(
  proposalId: string,
  sectionKey: SectionKey,
  content: string,
): Promise<{ ok: boolean; message?: string }> {
  const actor = await requireProfile();
  assertNotApproverEditing(actor);

  const db = await getServerClient();

  const { data: proposalRow } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (!proposalRow) throw new RuleViolation("Proposal not found.", "not_found");

  const proposal = proposalRow as Proposal;
  assertAuthor(proposal, actor);
  // Rule 1: content is editable only in `draft` — or `changes_requested`,
  // which this edit moves back to draft.
  assertEditable(proposal);

  const { data: sectionRow } = await db
    .from("proposal_sections")
    .select("*")
    .eq("proposal_id", proposalId)
    .eq("section_key", sectionKey)
    .single();

  if (!sectionRow) {
    return { ok: false, message: `Section "${sectionKey}" does not exist.` };
  }

  const section = sectionRow as ProposalSection;

  if (section.source === "template") {
    // Editing the prose here would be overwritten the next time the intake
    // field changes, so it is refused rather than silently lost.
    return {
      ok: false,
      message:
        "This section is rendered from the intake. Edit the intake field and " +
        "it rewrites itself.",
    };
  }

  const trimmed = content.trim();
  if (trimmed === "") {
    return {
      ok: false,
      message:
        "A section cannot be emptied by hand. Rewrite it, or leave it as it is.",
    };
  }

  const { error } = await db
    .from("proposal_sections")
    .update({
      content: trimmed,
      edited_by_human: true,
      // `stale_fields` is deliberately NOT cleared. A hand-edit fixes the
      // prose; it does not mean the salesperson reconciled this section with
      // every intake change that happened since it was written.
    })
    .eq("id", section.id);

  if (error) {
    return { ok: false, message: `Could not save: ${error.message}` };
  }

  // Acting on the approver's notes returns the proposal to draft (rule 6), so
  // the queue stops showing it as waiting on the salesperson.
  const nextStatus = editableStatusAfter(proposal);
  if (nextStatus) {
    await db
      .from("proposals")
      .update({ status: nextStatus })
      .eq("id", proposalId);
  }

  await logActivity({
    proposalId,
    actorName: actor.full_name,
    event: "intake_edited",
    detail: `${section.title} edited by hand.`,
  });

  revalidatePath(`/proposals/${proposalId}`);
  return { ok: true };
}
