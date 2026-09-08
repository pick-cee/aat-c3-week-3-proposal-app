import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminClient } from "@/lib/db/admin";
import type { ActivityEvent } from "@/lib/db/types";

export interface ActivityEntry {
  proposalId: string | null;
  actorName: string | null;
  event: ActivityEvent;
  detail?: string;
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export async function logActivity(
  entry: ActivityEntry,
  client?: SupabaseClient,
): Promise<void> {
  const db = client ?? getAdminClient();

  const { error } = await db.from("activity_log").insert({
    proposal_id: entry.proposalId,
    actor_name: entry.actorName,
    event: entry.event,
    detail: entry.detail ?? null,
    model_used: entry.modelUsed ?? null,
    input_tokens: entry.inputTokens ?? 0,
    output_tokens: entry.outputTokens ?? 0,
  });

  if (error) {
    // Deliberately does not throw. Losing an audit row is bad; failing the
    // user's action because the audit row could not be written is worse — it
    // would turn a logging outage into an outage of the whole application.
    // Surfaced to the server console so it is not silent.
    console.error(
      `[activity_log] failed to record "${entry.event}" for proposal ` +
      `${entry.proposalId ?? "(none)"}: ${error.message}`,
    );
  }
}
