"use client";

import { useState, useTransition } from "react";

import { sendProposal } from "@/app/actions/send";
import { Icon, Note, buttonClass, cn } from "@/components/ui/primitives";
import type { Delivery } from "@/lib/db/types";
import { formatDateTime } from "@/lib/format";

/**
 * Sending, and everything that has happened to previous attempts.
 *
 * Two rules this panel exists to honour:
 *
 *   The real intended recipient is shown BEFORE sending, even in demo mode. A
 *   demo that hides where the mail would have gone is not demonstrating the
 *   thing that matters.
 *
 *   A retry button appears only when retrying could actually help. A domain
 *   that is not verified will fail identically a hundred times.
 */
export function SendPanel({
  proposalId,
  intendedRecipient,
  actualRecipient,
  demoMode,
  deliveries,
  previewUrl,
}: {
  proposalId: string;
  intendedRecipient: string | null;
  actualRecipient: string;
  demoMode: boolean;
  deliveries: Delivery[];
  /**
   * The client-facing page, exactly as it will look in their browser.
   *
   * Different typography, different layout, no application chrome — a
   * salesperson who has only seen the editor cards has not seen the document
   * they are about to send.
   */
  previewUrl: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    ok: boolean;
    reason?: string;
    needsPlaceholderAck?: boolean;
  } | null>(null);

  const succeeded = deliveries.find((d) => d.status === "sent");
  const latest = deliveries[0] ?? null;
  const inTrouble = !succeeded && latest?.status === "failed";

  // The stored flag from the failure that actually happened, not a guess.
  const canRetry = inTrouble && (latest?.retryable ?? false);
  const hasAttempted = deliveries.length > 0;

  if (succeeded) {
    return (
      <div className="rounded-lg border border-state-sent/25 bg-state-sent-fill/40 p-5">
        <div className="flex gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-state-sent/15 text-state-sent">
            <Icon name="check" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-ink">Delivered to the client</p>
            <p className="mt-1 text-sm text-ink-muted">
              Sent to{" "}
              <span className="font-medium text-ink">
                {succeeded.actual_recipient}
              </span>{" "}
              on{" "}
              {formatDateTime(succeeded.created_at)}
              .
              {succeeded.demo_mode &&
                succeeded.intended_recipient !== succeeded.actual_recipient && (
                  <>
                    {" "}
                    Demo mode was on, so it went there instead of{" "}
                    {succeeded.intended_recipient}.
                  </>
                )}
            </p>
            {deliveries.length > 1 && <History deliveries={deliveries} />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-5",
        inTrouble
          ? "border-state-failed/30 bg-state-failed-fill/40"
          : "border-line bg-surface",
      )}
    >
      <div className="flex gap-3">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            inTrouble
              ? "bg-state-failed/15 text-state-failed"
              : "bg-accent/8 text-ink-muted",
          )}
        >
          <Icon name={inTrouble ? "alert" : "send"} className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">
            {inTrouble ? "This never reached the client" : "Send to the client"}
          </p>

          {inTrouble && latest?.failure_reason && (
            <p className="mt-1 text-sm text-[hsl(0_74%_35%)]">
              {latest.failure_reason}
            </p>
          )}

          <div className="mt-3 rounded border border-line bg-surface px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs text-ink-subtle">Client</span>
              <span className="font-medium text-ink">
                {intendedRecipient ?? (
                  <span className="italic text-state-failed">
                    no address on file
                  </span>
                )}
              </span>
            </div>

            {demoMode && (
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 border-t border-line pt-1.5">
                <span className="text-xs text-ink-subtle">Actually goes to</span>
                <span className="font-medium text-ink">{actualRecipient}</span>
                <span className="rounded bg-state-review-fill px-1.5 py-0.5 text-2xs font-medium text-[hsl(32_81%_29%)]">
                  demo mode
                </span>
              </div>
            )}
          </div>

          {/*
            One flex row, not two inline-level elements in a row box.

            The button and the link are both `inline-flex`, so with nothing
            between them they laid out on the same line and overlapped — and
            their `mt-*` margins did nothing, because vertical margins do not
            separate inline-level boxes.

            The order is also deliberate: the send button comes first. Sending
            is the primary action here, and it previously sat below a secondary
            text link, so the eye met "Preview" on its way to the thing it came
            for.
          */}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {(!hasAttempted || canRetry) && (
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    setResult(await sendProposal(proposalId));
                  })
                }
                disabled={pending || !intendedRecipient}
                className={buttonClass(inTrouble ? "danger" : "primary")}
              >
                <Icon name="send" className="h-4 w-4" />
                {pending ? "Sending…" : inTrouble ? "Try again" : "Send proposal"}
              </button>
            )}

            {/*
              Look at it as the client will, before it becomes irreversible.

              A button rather than a text link: this is a real action sitting
              beside another one, and a bare link next to a solid button reads
              as fine print — easy to skip at exactly the moment it matters
              most. Secondary styling keeps the send button clearly primary.
            */}
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonClass(
                "secondary",
                "md",
                // The panel is white and `secondary` is white too, so this
                // button's only boundary is its border — and `line-strong`
                // measures 1.48:1 against the panel, well under the 3:1 that
                // WCAG 1.4.11 asks of a UI component boundary. A grey fill
                // alone does not fix it (sunken is 1.10:1 against white), so
                // the border carries the shape: `ink-subtle` measures 5.25:1
                // against the panel and 4.79:1 against the fill.
                //
                // `hover:border-ink-subtle` is not redundant: the variant sets
                // `hover:border-line-strong`, which would otherwise snap the
                // border back to the failing value on hover.
                "border-ink-subtle hover:border-ink-subtle " +
                  "bg-surface-sunken hover:bg-surface-sunken/60",
              )}
            >
              <Icon name="file" className="h-4 w-4" />
              Preview what the client will see
            </a>
          </div>

          {/* No retry button. Offering one for a problem retrying cannot fix
              teaches people to distrust every button in the application. */}
          {inTrouble && !canRetry && (
            <Note tone="danger" className="mt-4">
              Retrying will not help with this one — it needs fixing at the
              source first.
            </Note>
          )}

          {/*
            A placeholder is not a failure — the send has not been attempted.
            It is a last look at something agreed hours earlier, with the
            option to go ahead.
          */}
          {result?.needsPlaceholderAck ? (
            <Note tone="warning" title="Before this goes out" className="mt-3">
              <p className="text-ink">{result.reason}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setResult(await sendProposal(proposalId, true));
                    })
                  }
                  className={buttonClass("primary", "sm")}
                >
                  Send it anyway
                </button>
                <a
                  href={`/proposals/${proposalId}/confirm`}
                  className={buttonClass("secondary", "sm")}
                >
                  Fill it in first
                </a>
              </div>
            </Note>
          ) : (
            result &&
            !result.ok &&
            result.reason && (
              <Note tone="danger" className="mt-3">
                {result.reason}
              </Note>
            )
          )}

          {hasAttempted && <History deliveries={deliveries} />}
        </div>
      </div>
    </div>
  );
}

/** Every attempt, so three failures followed by a success reads as a story. */
function History({ deliveries }: { deliveries: Delivery[] }) {
  return (
    <details className="group mt-4">
      <summary className="cursor-pointer list-none text-xs font-medium text-ink-muted transition-colors hover:text-ink">
        <span className="inline-flex items-center gap-1">
          <Icon
            name="arrow-left"
            className="h-3 w-3 -rotate-90 transition-transform group-open:rotate-90"
          />
          {deliveries.length} delivery attempt
          {deliveries.length === 1 ? "" : "s"}
        </span>
      </summary>

      <ol className="mt-2 space-y-1.5">
        {[...deliveries]
          .sort((a, b) => a.attempt - b.attempt)
          .map((delivery) => (
            <li
              key={delivery.id}
              className="rounded border border-line bg-surface px-3 py-2 text-xs"
            >
              <p className="flex flex-wrap items-center gap-x-2">
                <span
                  className={cn(
                    "font-medium",
                    delivery.status === "sent"
                      ? "text-state-approved"
                      : "text-state-failed",
                  )}
                >
                  Attempt {delivery.attempt} ·{" "}
                  {delivery.status === "sent" ? "delivered" : "failed"}
                </span>
                <span className="text-ink-subtle tabular">
                  {formatDateTime(delivery.created_at)}
                </span>
              </p>

              {delivery.failure_reason && (
                <p className="mt-1 text-ink-muted">{delivery.failure_reason}</p>
              )}

              {/* The raw provider error, kept for whoever has to debug it. */}
              {delivery.error && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-2xs text-ink-subtle">
                    Technical detail
                  </summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-surface-sunken p-2 font-mono text-2xs text-ink-muted">
                    {delivery.error}
                  </pre>
                </details>
              )}
            </li>
          ))}
      </ol>
    </details>
  );
}
