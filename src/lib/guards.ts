import { RuleViolation } from "@/lib/errors";
import type { Profile, Proposal } from "@/lib/db/types";

/** Rule 1: content is editable only in `draft`. */
export function assertEditable(proposal: Proposal): void {
  if (proposal.status === "draft") return;

  if (proposal.status === "changes_requested") {
    // Not an error state: the first edit moves it back to draft. Callers that
    // intend to edit should transition first, so reaching here is a bug.
    throw new RuleViolation(
      "This proposal has changes requested. Editing it returns it to draft first.",
      "needs_transition_to_draft",
    );
  }

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
