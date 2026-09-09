import { STALE_IN_REVIEW_HOURS } from "@/lib/constants";
import type { Delivery, Profile, Proposal } from "@/lib/db/types";
import type { DisplayStatus } from "@/components/StatusPill";


export interface QueueItem {
  proposal: Proposal;
  displayStatus: DisplayStatus;
  /** Latest failed delivery, when the proposal is in the failed band. */
  failure: Delivery | null;
  /** Hours since it last changed. */
  ageHours: number;
  /** In review past STALE_IN_REVIEW_HOURS. */
  isStale: boolean;
  /** This person is the one who has to act. */
  needsMe: boolean;
  /** Sections with content, for the progress meter on the card. */
  sectionsWritten: number;
  sectionsTotal: number;
}

export function toQueueItem(
  proposal: Proposal,
  deliveries: Delivery[],
  actor: Profile,
  now: number = Date.now(),
  sections: { written: number; total: number } = { written: 0, total: 6 },
): QueueItem {
  // Newest first. Sorted here rather than relying on the caller's query order,
  // so this function is correct on its own terms.
  const sorted = [...deliveries].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const succeeded = sorted.some((d) => d.status === "sent");
  const latest = sorted[0] ?? null;

  // A success anywhere in the history clears the trouble, whenever it happened:
  // three failures followed by a success is a delivered proposal.
  const inTrouble = !succeeded && latest?.status === "failed";

  const ageHours =
    (now - new Date(proposal.updated_at).getTime()) / (1000 * 60 * 60);

  return {
    proposal,
    displayStatus: inTrouble ? "send_failed" : proposal.status,
    failure: inTrouble ? latest : null,
    ageHours,
    isStale:
      proposal.status === "in_review" && ageHours > STALE_IN_REVIEW_HOURS,
    needsMe: whoNeedsToAct(proposal, inTrouble, actor),
    sectionsWritten: sections.written,
    sectionsTotal: sections.total,
  };
}

/**
 * Whether this person is the one blocking progress. Drives the single line at
 * the top of the queue — the thing that has to be readable in five seconds.
 */
export function whoNeedsToAct(
  proposal: Proposal,
  inTrouble: boolean,
  actor: Profile,
): boolean {
  const isAuthor = proposal.author_id === actor.id;

  // Only the author can retry a send, so a failed delivery is never the
  // approver's problem however loudly it is displayed.
  if (inTrouble) return isAuthor;

  switch (proposal.status) {
    case "draft":
    case "changes_requested":
      return isAuthor;
    case "in_review":
      // An author who is somehow also an approver still cannot approve their
      // own work, so this must never be their action.
      return actor.role === "approver" && !isAuthor;
    case "approved":
      return isAuthor; // waiting to be sent
    case "sent":
      return false;
  }
}

/**
 * Failed sends first, then whatever needs this person, then everything else.
 *
 * The failed band ignores age entirely: a send that failed three weeks ago is
 * still a client sitting with nothing.
 *
 * Within a band, the direction depends on what the band is for, and the two
 * answers genuinely differ:
 *
 *   The first two bands are work someone owes. There the thing that has been
 *   waiting longest is the most urgent, so they run oldest first — a proposal
 *   sitting unreviewed for three days must not be pushed down the page by one
 *   submitted this morning.
 *
 *   The last band owes nobody anything; it is a record. Nothing in it is
 *   urgent, so age is the wrong axis entirely and recency is the useful one —
 *   what a salesperson looks for there is the proposal they just touched, and
 *   oldest-first buries it under every proposal they have ever sent.
 */
export function compareQueueItems(a: QueueItem, b: QueueItem): number {
  const band = (item: QueueItem) => {
    if (item.displayStatus === "send_failed") return 0;
    if (item.needsMe) return 1;
    return 2;
  };

  const bandOf = band(a);
  const bandDiff = bandOf - band(b);
  if (bandDiff !== 0) return bandDiff;

  // Nothing outstanding: most recently touched first.
  if (bandOf === 2) return a.ageHours - b.ageHours;

  // Outstanding work: longest-waiting first.
  return b.ageHours - a.ageHours;
}

/** The one-line summary at the top of the queue. */
export function queueHeadline(items: QueueItem[], actor: Profile): string {
  const failed = items.filter((i) => i.displayStatus === "send_failed").length;
  if (failed > 0) {
    return failed === 1
      ? "1 approved proposal never reached its client."
      : `${failed} approved proposals never reached their clients.`;
  }

  const mine = items.filter((i) => i.needsMe).length;
  if (mine === 0) {
    return actor.role === "approver"
      ? "Nothing is waiting for your approval."
      : "Nothing needs you right now.";
  }

  if (actor.role === "approver") {
    return mine === 1
      ? "1 proposal is waiting for your approval."
      : `${mine} proposals are waiting for your approval.`;
  }

  return mine === 1 ? "1 proposal needs you." : `${mine} proposals need you.`;
}

/** "3 days", "4 hours" — for how long something has been sitting. */
export function describeAge(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) {
    const h = Math.floor(hours);
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}
