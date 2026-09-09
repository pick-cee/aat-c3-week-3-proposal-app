"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity";
import { requireProfile } from "@/lib/auth";
import { ModelCallError } from "@/lib/anthropic";
import { MAX_MATERIALS_SUMMARIZED } from "@/lib/constants";
import { getServerClient } from "@/lib/db/server";
import type { Proposal, SupportingMaterial } from "@/lib/db/types";
import { RuleViolation } from "@/lib/errors";
import {
  assertAuthor,
  assertEditable,
  editableStatusAfter,
} from "@/lib/guards";
import { extractFile } from "@/lib/materials/extract";
import { classifyFile, unsupportedReason } from "@/lib/materials/formats";
import { summarizeMaterial } from "@/lib/materials/summarize";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";

export interface UploadSlot {
  materialId: string;
  storagePath: string;
  /** PUT the file here. Expires shortly.  */
  signedUrl: string;
  token: string;
}

export async function requestUploadSlot(
  proposalId: string,
  filename: string,
  mimeType: string | null,
  sizeBytes: number,
): Promise<UploadSlot> {
  const actor = await requireProfile();
  const db = await getServerClient();

  const { data: row } = await db
    .from("proposals")
    .select("*")
    .eq("id", proposalId)
    .single();

  if (!row) throw new RuleViolation("Proposal not found.", "not_found");

  const proposal = row as Proposal;
  assertAuthor(proposal, actor);
  assertEditable(proposal);

  // Adding material after a rejection is acting on the approver's notes.
  const nextStatus = editableStatusAfter(proposal);
  if (nextStatus) {
    await db.from("proposals").update({ status: nextStatus }).eq("id", proposalId);
  }

  // Namespaced by proposal so the storage policies can find the owner, and
  // prefixed with a timestamp so re-uploading the same filename does not
  // silently overwrite the first one.
  const safeName = filename.replace(/[^\w.\-]+/g, "_").slice(-100);
  const storagePath = `${proposalId}/${Date.now()}-${safeName}`;

  const { data: material, error } = await db
    .from("supporting_materials")
    .insert({
      proposal_id: proposalId,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      storage_path: storagePath,
      // The row exists before the bytes do. `pending` is what makes a
      // half-finished upload visible rather than absent.
      extraction_status: "pending",
      extraction_note: "Uploading…",
    })
    .select()
    .single();

  if (error || !material) {
    throw new Error(`Could not record the upload: ${error?.message}`);
  }

  const { data: signed, error: signError } = await db.storage
    .from("materials")
    .createSignedUploadUrl(storagePath);

  if (signError || !signed) {
    // Leave the row: it now says the upload failed, which is the point.
    await db
      .from("supporting_materials")
      .update({
        extraction_status: "failed",
        extraction_note: `Could not start the upload: ${signError?.message}`,
      })
      .eq("id", material.id);

    throw new Error(`Could not start the upload: ${signError?.message}`);
  }

  return {
    materialId: material.id,
    storagePath,
    signedUrl: signed.signedUrl,
    token: signed.token,
  };
}

/**
 * Extracts and summarizes one uploaded file.
 *
 * Called per file after its bytes land. Each file is processed on its own so
 * one unreadable upload never aborts the batch — DESIGN.md section 7 is
 * explicit that every file is accounted for.
 */
export async function processMaterial(materialId: string): Promise<void> {
  const actor = await requireProfile();
  const db = await getServerClient();

  const { data: row } = await db
    .from("supporting_materials")
    .select("*")
    .eq("id", materialId)
    .single();

  if (!row) throw new RuleViolation("Material not found.", "not_found");
  const material = row as SupportingMaterial;

  // Cheap rejection before downloading anything.
  if (classifyFile(material.filename, material.mime_type) === "unsupported") {
    await db
      .from("supporting_materials")
      .update({
        extraction_status: "unsupported",
        extraction_note: unsupportedReason(
          material.filename,
          material.mime_type,
        ),
      })
      .eq("id", materialId);

    revalidatePath(`/proposals/${material.proposal_id}`);
    return;
  }

  const { data: blob, error: downloadError } = await db.storage
    .from("materials")
    .download(material.storage_path!);

  if (downloadError || !blob) {
    await db
      .from("supporting_materials")
      .update({
        extraction_status: "failed",
        extraction_note:
          `The file was recorded but could not be read back from storage: ` +
          `${downloadError?.message ?? "no data"}. Try uploading it again.`,
      })
      .eq("id", materialId);

    revalidatePath(`/proposals/${material.proposal_id}`);
    return;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const extraction = await extractFile(
    material.filename,
    material.mime_type,
    bytes,
  );

  await db
    .from("supporting_materials")
    .update({
      extraction_status: extraction.status,
      extraction_note: extraction.note,
      extracted_text: extraction.text,
    })
    .eq("id", materialId);

  // Only readable files are worth a model call.
  if (extraction.status !== "ok") {
    revalidatePath(`/proposals/${material.proposal_id}`);
    return;
  }

  await summarizeIfUnderCap(material, extraction, bytes, actor.full_name);
  revalidatePath(`/proposals/${material.proposal_id}`);
}

/**
 * Summarizes, unless this proposal already has its allowance of summaries.
 *
 * Files beyond the cap are stored and shown with the reason visible — an
 * uncounted file is a silent cost, and a silently ignored file is worse. The
 * cap counts every material on the version however it arrived, so an inherited
 * set from a fork leaves no room rather than doubling the budget.
 */
async function summarizeIfUnderCap(
  material: SupportingMaterial,
  extraction: Awaited<ReturnType<typeof extractFile>>,
  bytes: Uint8Array,
  actorName: string,
): Promise<void> {
  const db = await getServerClient();

  const { count } = await db
    .from("supporting_materials")
    .select("id", { count: "exact", head: true })
    .eq("proposal_id", material.proposal_id)
    .eq("summarized", true);

  if ((count ?? 0) >= MAX_MATERIALS_SUMMARIZED) {
    await db
      .from("supporting_materials")
      .update({
        extraction_note:
          `Read successfully, but this proposal already has ` +
          `${MAX_MATERIALS_SUMMARIZED} summarized files — the limit that keeps ` +
          `one proposal from costing an unbounded amount. This file was stored ` +
          `and its text kept, but it was not summarized and will not inform ` +
          `generation. Remove another file if this one matters more.`,
      })
      .eq("id", material.id);
    return;
  }

  const limit = await checkRateLimit();
  if (!limit.allowed) {
    await db
      .from("supporting_materials")
      .update({ extraction_note: rateLimitMessage(limit) })
      .eq("id", material.id);

    await logActivity({
      proposalId: material.proposal_id,
      actorName,
      event: "rate_limited",
      detail: `Summarizing ${material.filename} was blocked by the hourly limit.`,
    });
    return;
  }

  try {
    const { summary, usage } = await summarizeMaterial({
      filename: material.filename,
      mimeType: material.mime_type,
      text: extraction.text,
      bytes: extraction.passthrough ? bytes : null,
      passthrough: extraction.passthrough,
    });

    await db
      .from("supporting_materials")
      .update({ summary, summarized: true })
      .eq("id", material.id);

    await logActivity({
      proposalId: material.proposal_id,
      actorName,
      event: "material_summarized",
      detail: `Summarized ${material.filename}.`,
      modelUsed: usage.modelUsed,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  } catch (error) {
    const failure =
      error instanceof ModelCallError
        ? error
        : new ModelCallError("unknown", String(error), true);

    // The extraction succeeded; only the summary failed. Status stays `ok` —
    // the text is still there and generation can use it — but the note says
    // what happened, because a missing summary changes what the model sees.
    await db
      .from("supporting_materials")
      .update({
        extraction_note:
          `Read successfully, but the summary could not be generated: ` +
          `${failure.message}` +
          (failure.retryable ? " Re-uploading will try again." : ""),
      })
      .eq("id", material.id);

    await logActivity({
      proposalId: material.proposal_id,
      actorName,
      event: "generation_failed",
      detail: `Summarizing ${material.filename} failed: ${failure.message}`,
    });
  }
}

export async function deleteMaterial(materialId: string): Promise<void> {
  const actor = await requireProfile();
  const db = await getServerClient();

  const { data: row } = await db
    .from("supporting_materials")
    .select("*, proposals(*)")
    .eq("id", materialId)
    .single();

  if (!row) throw new RuleViolation("Material not found.", "not_found");

  const material = row as SupportingMaterial & { proposals: Proposal };
  assertAuthor(material.proposals, actor);
  assertEditable(material.proposals);

  // The row always goes. The BYTES only go if no other version references them.
  //
  // A fork re-links materials rather than copying the file, so several versions
  // can point at one object. Deleting it because v2 dropped the file would
  // silently gut an approved — possibly already sent — v1, and nothing would
  // report it until someone opened that version and found a missing document.
  if (material.storage_path) {
    const { count } = await db
      .from("supporting_materials")
      .select("id", { count: "exact", head: true })
      .eq("storage_path", material.storage_path)
      .neq("id", materialId);

    if ((count ?? 0) === 0) {
      await db.storage.from("materials").remove([material.storage_path]);
    }
  }

  await db.from("supporting_materials").delete().eq("id", materialId);
  revalidatePath(`/proposals/${material.proposal_id}`);
}
