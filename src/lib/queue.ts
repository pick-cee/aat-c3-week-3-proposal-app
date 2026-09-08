import "server-only";

import { getServerClient } from "@/lib/db/server";
import type { Delivery, Profile, Proposal } from "@/lib/db/types";
import { compareQueueItems, toQueueItem, type QueueItem } from "@/lib/queue-logic";

export {
  describeAge,
  queueHeadline,
  type QueueItem,
} from "@/lib/queue-logic";

/**
 * Loads the queue. The rules about what is urgent live in `queue-logic.ts`,
 * which is pure and tested; this is only the fetch.
 */
export async function loadQueue(actor: Profile): Promise<QueueItem[]> {
  const db = await getServerClient();

  // RLS decides what is visible: a salesperson sees their own, an approver sees
  // anything that has left draft. Filtering again here would create a second
  // place for that rule to drift.
  const { data: proposals } = await db
    .from("proposals")
    .select("*")
    .order("updated_at", { ascending: false });

  if (!proposals?.length) return [];

  const ids = proposals.map((p) => p.id);

  const [{ data: deliveries }, { data: sections }] = await Promise.all([
    db.from("deliveries").select("*").in("proposal_id", ids),
    // Only what the progress meter needs, not whole section bodies — this runs
    // for every card on the queue.
    db
      .from("proposal_sections")
      .select("proposal_id, content")
      .in("proposal_id", ids),
  ]);

  const byProposal = new Map<string, Delivery[]>();
  for (const delivery of (deliveries ?? []) as Delivery[]) {
    const list = byProposal.get(delivery.proposal_id) ?? [];
    list.push(delivery);
    byProposal.set(delivery.proposal_id, list);
  }

  const progress = new Map<string, { written: number; total: number }>();
  for (const row of (sections ?? []) as Array<{
    proposal_id: string;
    content: string | null;
  }>) {
    const current = progress.get(row.proposal_id) ?? { written: 0, total: 0 };
    current.total += 1;
    if (row.content) current.written += 1;
    progress.set(row.proposal_id, current);
  }

  return (proposals as Proposal[])
    .map((proposal) =>
      toQueueItem(
        proposal,
        byProposal.get(proposal.id) ?? [],
        actor,
        Date.now(),
        progress.get(proposal.id) ?? { written: 0, total: 6 },
      ),
    )
    .sort(compareQueueItems);
}
