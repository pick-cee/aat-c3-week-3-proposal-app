import { RuleViolation } from "@/lib/errors";
import type { Profile, Proposal } from "@/lib/db/types";

/**
 * Rule 1: content is editable only in `draft` — and `changes_requested`,
 * which is on its way there.
 *
 * DESIGN.md section 2 rule 6: a rejected proposal "returns to `draft` on the
 * salesperson's first edit". So an edit in `changes_requested` is not merely
 * permitted, it is the transition itself. This guard previously threw and told
 * callers to transition first, which meant every edit path had to remember to
 * do it — and three of the four did not. A salesperson who acted on the
 * approver's notes got a 500.
 *
 * The transition is now the caller's to PERFORM (they hold the database
 * handle) but no longer theirs to REMEMBER: `editableStatusAfter` says what the
 * status should become, and forgetting to apply it costs a stale status rather
 * than a crash.
 */
export function assertEditable(proposal: Proposal): void {
  if (proposal.status === "draft") return;
  if (proposal.status === "changes_requested") return;

  if (proposal.status === "in_review") {
    throw new RuleViolation(
      "This proposal is with the approver and cannot be edited while it is being reviewed. " +
      "Ask them to request changes if it needs work.",
      "locked_in_review",
    );
  }

  // approved / sent
  throw new RuleViolation(
    "This version was approved and is frozen permanently. " +
    "Editing it creates a new version, leaving the approved one exactly as it was.",
    "frozen_fork_instead",
  );
}

/**
 * The status a proposal should carry once it has been edited, or null when it
 * already carries the right one.
 *
 * Editing a rejected proposal returns it to `draft` — the approver's note has
 * been acted on, and the queue needs to stop showing it as waiting on the
 * salesperson to respond. Returning null rather than always returning "draft"
 * keeps callers from issuing a pointless write on every keystroke-level save.
 */
export function editableStatusAfter(
  proposal: Proposal,
): "draft" | null {
  return proposal.status === "changes_requested" ? "draft" : null;
}

/** Only the author acts on their own proposal. */
export function assertAuthor(proposal: Proposal, actor: Profile): void {
  if (proposal.author_id !== actor.id) {
    throw new RuleViolation(
      "This proposal belongs to someone else.",
      "not_author",
    );
  }
}


export function assertCanApprove(proposal: Proposal, actor: Profile): void {
  if (actor.role !== "approver") {
    throw new RuleViolation(
      "Only an approver can make this decision.",
      "not_approver",
    );
  }

  if (proposal.author_id === actor.id) {
    throw new RuleViolation(
      "You wrote this proposal, so you cannot approve it. " +
      "Approval by the author is not a control — it only looks like one.",
      "author_cannot_approve",
    );
  }

  if (proposal.status !== "in_review") {
    throw new RuleViolation(
      `This proposal is ${describeStatus(proposal.status)}, not awaiting review.`,
      "not_in_review",
    );
  }
}

/** Rule 5: only `approved` can be sent, and only by the author. */
export function assertSendable(proposal: Proposal, actor: Profile): void {
  if (proposal.author_id !== actor.id) {
    throw new RuleViolation(
      "Only the person who wrote this proposal can send it. " +
      "The approver's job ends at the decision.",
      "only_author_sends",
    );
  }

  if (proposal.status === "sent") {
    throw new RuleViolation(
      "This version has already been sent. Sending it again would deliver the " +
      "client a second copy of the same proposal.",
      "already_sent",
    );
  }

  if (proposal.status !== "approved") {
    throw new RuleViolation(
      `This proposal is ${describeStatus(proposal.status)}. ` +
      "Only an approved proposal can be sent to a client.",
      "not_approved",
    );
  }
}

/** Rule 2: editing an approved proposal forks rather than modifies. */
export function assertForkable(proposal: Proposal, actor: Profile): void {
  assertAuthor(proposal, actor);

  if (proposal.status !== "approved" && proposal.status !== "sent") {
    throw new RuleViolation(
      "Only an approved proposal forks to a new version. " +
      "This one can be edited directly.",
      "not_frozen",
    );
  }
}

/** Rule 4: the approver reads and decides; they never become an author. */
export function assertNotApproverEditing(actor: Profile): void {
  if (actor.role === "approver") {
    throw new RuleViolation(
      "Approvers review proposals and cannot edit them. " +
      "Request changes with a note instead.",
      "approver_cannot_edit",
    );
  }
}

function describeStatus(status: Proposal["status"]): string {
  switch (status) {
    case "draft":
      return "still a draft";
    case "in_review":
      return "awaiting review";
    case "changes_requested":
      return "waiting on requested changes";
    case "approved":
      return "approved";
    case "sent":
      return "already sent";
  }
}
