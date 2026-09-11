"use client";

import { useState, useTransition } from "react";

import { deleteDraft } from "@/app/actions/proposals";
import { Icon, buttonClass, cn } from "@/components/ui/primitives";

/**
 * Deleting a draft from the queue, without opening it.
 *
 * The card is one large `<Link>`, so this cannot be a plain nested button: a
 * `<button>` inside an `<a>` is invalid HTML, and a click on it would navigate
 * to the proposal instead of doing anything. It is therefore positioned ABOVE
 * the link rather than inside it, and every handler stops propagation so the
 * card's navigation never fires underneath.
 *
 * It still asks first. Deleting from a list is easier to do by accident than
 * deleting from inside the thing being deleted — there is no context on screen
 * to tell you what you are about to lose — so the confirm names the proposal.
 */
export function DeleteDraftButton({
  proposalId,
  label,
}: {
  proposalId: string;
  /** What to name in the confirmation, so "which one?" is never a question. */
  label: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /** Every interaction here must stay off the underlying card link. */
  function swallow(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (confirming) {
    return (
      <span
        onClick={swallow}
        className="absolute inset-0 z-20 flex flex-wrap items-center justify-center gap-2 rounded-lg bg-surface/95 px-4 text-center backdrop-blur-sm"
      >
        <span className="text-sm text-ink">
          Delete <span className="font-medium">{label}</span>? This cannot be
          undone.
        </span>

        <button
          type="button"
          disabled={pending}
          onClick={(e) => {
            swallow(e);
            setError(null);
            startTransition(async () => {
              try {
                await deleteDraft(proposalId);
              } catch (err) {
                // A redirect throws by design; anything else is a real failure.
                if (
                  err instanceof Error &&
                  err.message.includes("NEXT_REDIRECT")
                ) {
                  throw err;
                }
                setError(err instanceof Error ? err.message : String(err));
              }
            });
          }}
          className={buttonClass("danger", "sm")}
        >
          {pending ? "Deleting…" : "Yes, delete it"}
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={(e) => {
            swallow(e);
            setConfirming(false);
          }}
          className={buttonClass("secondary", "sm")}
        >
          Keep it
        </button>

        {error && (
          <span className="w-full text-xs text-state-failed">{error}</span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Delete ${label}`}
      onClick={(e) => {
        swallow(e);
        setConfirming(true);
      }}
      className={cn(
        "absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded",
        "text-ink-subtle transition-colors",
        "hover:bg-state-failed-fill hover:text-state-failed",
        // Always visible on touch, where there is no hover to reveal it.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-failed/40",
      )}
    >
      <Icon name="trash" className="h-4 w-4" label={`Delete ${label}`} />
    </button>
  );
}
