"use client";

import { useState, useTransition } from "react";

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
}: {
  proposal: Proposal;
  blockingReason: string | null;
  staleCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
