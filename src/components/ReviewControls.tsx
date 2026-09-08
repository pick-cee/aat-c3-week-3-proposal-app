"use client";

import { useState, useTransition } from "react";

import { approveProposal, requestChanges } from "@/app/actions/review";
import { Icon, Note, buttonClass, cn } from "@/components/ui/primitives";

/**
 * Approve, or request changes with a required note.
 *
 * The approver cannot edit content — separation of duties means the reviewer
 * does not become an author. The only two things they can do are here, and
 * neither touches the proposal's text.
 */
export function ReviewControls({
  proposalId,
  staleCount,
}: {
  proposalId: string;
  staleCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"idle" | "approving" | "rejecting">("idle");
  const [note, setNote] = useState("");
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

  if (mode === "idle") {
    return (
      <div className="card p-5">
        <p className="font-medium text-ink">Your decision</p>
        <p className="mt-1 text-sm text-ink-muted">
          Approving releases this to the salesperson to send. It does not send
          anything itself.
        </p>

        {staleCount > 0 && (
          <Note tone="warning" className="mt-3">
            <span className="flex items-start gap-1.5">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {staleCount} section{staleCount === 1 ? "" : "s"}{" "}
                {staleCount === 1 ? "was" : "were"} written before the intake
                last changed. Worth checking they still match what was agreed.
              </span>
            </span>
          </Note>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("approving")}
            className={buttonClass("success")}
          >
            <Icon name="check" className="h-4 w-4" />
            Approve
          </button>
          <button
            type="button"
            onClick={() => setMode("rejecting")}
            className={buttonClass("secondary")}
          >
            Request changes
          </button>
        </div>

        {error && (
          <Note tone="danger" className="mt-3">
            {error}
          </Note>
        )}
      </div>
    );
  }

  const isApproving = mode === "approving";

  return (
    <div
      className={cn(
        "rounded-lg border p-5 animate-fade",
        isApproving
          ? "border-state-approved/30 bg-state-approved-fill/40"
          : "border-state-changes/30 bg-state-changes-fill/40",
      )}
    >
      <p className="font-medium text-ink">
        {isApproving ? "Approve this proposal" : "What needs to change?"}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {isApproving
          ? "A note is optional. It is kept with the approval permanently."
          : "Required. The salesperson works from this — be specific."}
      </p>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        autoFocus
        placeholder={
          isApproving
            ? "Anything worth recording alongside the approval…"
            : "e.g. The deliverables section promises onboarding support we did not scope."
        }
        className="mt-3 block w-full rounded border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-sm transition-colors placeholder:text-ink-subtle focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending || (!isApproving && note.trim() === "")}
          onClick={() =>
            act(() =>
              isApproving
                ? approveProposal(proposalId, note)
                : requestChanges(proposalId, note),
            )
          }
          className={buttonClass(isApproving ? "success" : "primary")}
        >
          {pending
            ? "Saving…"
            : isApproving
              ? "Confirm approval"
              : "Send it back"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("idle");
            setError(null);
          }}
          className={buttonClass("secondary")}
        >
          Cancel
        </button>
      </div>

      {error && (
        <Note tone="danger" className="mt-3">
          {error}
        </Note>
      )}
    </div>
  );
}
