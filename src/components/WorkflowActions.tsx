"use client";

import { useState, useTransition } from "react";

import { deleteDraft } from "@/app/actions/proposals";
import { forkProposal, submitForReview } from "@/app/actions/review";
import { Icon, Note, buttonClass, cn } from "@/components/ui/primitives";
import type { Proposal } from "@/lib/db/types";

/**
 * What the author can do next, given where the proposal is.
 *
 * Every disabled state states its reason. A control that is greyed out with no
 * explanation is indistinguishable from a broken one.
 */
export function WorkflowActions({
  proposal,
  blockingReason,
  staleCount,
  successor,
}: {
  proposal: Proposal;
  blockingReason: string | null;
  staleCount: number;
  /** The version already forked from this one, if there is one. */
  successor: Pick<Proposal, "id" | "version" | "status"> | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function act(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        // A redirect throws by design; anything else is a real failure.
        if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (proposal.status === "in_review") {
    return (
      <Panel tone="review" icon="clock" title="Waiting on the approver">
        It cannot be edited while it is being reviewed. If it needs work, ask
        the approver to send it back.
      </Panel>
    );
  }

  if (proposal.status === "approved" || proposal.status === "sent") {
    /*
      This version has already been continued.

      The fork button must not appear here. Pressing it made a SECOND version
      numbered N+1 — two rows both claiming to continue this one — because
      nothing on this page said the work had already moved on. The mistake is
      easy to make and invisible afterwards: the salesperson opens v1, which is
      still on the queue and is the version they know, and presses the button
      expecting v3.

      So the control becomes a way to reach the work instead of a way to
      duplicate it.
    */
    if (successor) {
      return (
        <Panel
          tone="neutral"
          icon="lock"
          title={`Version ${proposal.version} is frozen`}
          action={
            <a
              href={`/proposals/${successor.id}`}
              className={buttonClass("secondary")}
            >
              Go to version {successor.version}
            </a>
          }
        >
          It stays exactly as approved, permanently.{" "}
          <span className="text-ink">
            This version has already been continued as version{" "}
            {successor.version}
          </span>
          , which is where the current work lives — so there is nothing to edit
          here. To make version {successor.version + 1}, open version{" "}
          {successor.version} and edit it from there.
        </Panel>
      );
    }

    return (
      <Panel
        tone="neutral"
        icon="lock"
        title={`Version ${proposal.version} is frozen`}
        action={
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => forkProposal(proposal.id))}
            className={buttonClass("secondary")}
          >
            {pending ? "Creating…" : `Edit as version ${proposal.version + 1}`}
          </button>
        }
        error={error}
      >
        It stays exactly as approved, permanently. Editing creates version{" "}
        {proposal.version + 1} as a new draft — the text and the uploaded files
        come with it, and it costs no model calls.
      </Panel>
    );
  }

  // draft or changes_requested
  return (
    <Panel
      tone="accent"
      icon="send"
      title="Ready for review?"
      action={
        <button
          type="button"
          disabled={pending || Boolean(blockingReason)}
          onClick={() => act(() => submitForReview(proposal.id))}
          className={buttonClass("primary")}
        >
          <Icon name="send" className="h-4 w-4" />
          {pending ? "Submitting…" : "Submit for review"}
        </button>
      }
      error={error}
    >
      Someone else has to approve this before it can reach the client.
      {blockingReason && (
        <span className="mt-2 block text-ink-muted">{blockingReason}</span>
      )}
      {/* Stale sections warn without blocking: the salesperson may have judged
          the change immaterial, and that is a call a human is entitled to make. */}
      {staleCount > 0 && !blockingReason && (
        <span className="mt-2 flex items-start gap-1.5 text-[hsl(32_81%_29%)]">
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {staleCount} section{staleCount === 1 ? "" : "s"}{" "}
            {staleCount === 1 ? "was" : "were"} written before the intake last
            changed. You can submit anyway — the approver sees the same markers.
          </span>
        </span>
      )}
      {/*
        Deleting is destructive and unrecoverable, so it is deliberately not a
        peer of "Submit" — it sits below a divider, in quiet type, and asks
        first. A `window.confirm` would be easier and worse: it is the same
        dialogue people dismiss reflexively all day, and it cannot name what is
        about to be lost.
      */}
      <span className="mt-4 block border-t border-line pt-3">
        {confirmingDelete ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-ink">
              Delete this draft and everything on it? This cannot be undone.
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => deleteDraft(proposal.id))}
              className={buttonClass("danger", "sm")}
            >
              {pending ? "Deleting…" : "Yes, delete it"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmingDelete(false)}
              className={buttonClass("secondary", "sm")}
            >
              Keep it
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmingDelete(true)}
            className={buttonClass("danger", "sm")}
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
            Delete this draft
          </button>
        )}
      </span>
    </Panel>
  );
}

function Panel({
  tone,
  icon,
  title,
  children,
  action,
  error,
}: {
  tone: "accent" | "review" | "neutral";
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  error?: string | null;
}) {
  const tones = {
    accent: "border-line bg-surface",
    review: "border-state-review/25 bg-state-review-fill/50",
    neutral: "border-line bg-surface-sunken/60",
  };

  const iconTones = {
    accent: "bg-accent/8 text-ink-muted",
    review: "bg-state-review/15 text-[hsl(32_81%_29%)]",
    neutral: "bg-surface text-ink-subtle",
  };

  return (
    <div className={cn("rounded-lg border p-5", tones[tone])}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              iconTones[tone],
            )}
          >
            <Icon name={icon} className="h-4 w-4" />
          </span>
          <div>
            <p className="font-medium text-ink">{title}</p>
            <div className="mt-1 max-w-lg text-sm text-ink-muted">
              {children}
            </div>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {error && (
        <Note tone="danger" className="mt-3">
          {error}
        </Note>
      )}
    </div>
  );
}
