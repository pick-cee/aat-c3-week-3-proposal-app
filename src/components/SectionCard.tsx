"use client";

import { useState, useTransition } from "react";

import { regenerateSection } from "@/app/actions/generate";
import {
  Icon,
  Meter,
  Note,
  Skeleton,
  buttonClass,
  cn,
} from "@/components/ui/primitives";
import { MAX_REGENERATIONS_PER_SECTION } from "@/lib/constants";
import { INTAKE_FIELD_LABELS, type ProposalSection } from "@/lib/db/types";
import { stalenessMessage } from "@/lib/policy/staleness";
import { sectionDefinition } from "@/lib/sections";

/**
 * One section, as a card.
 *
 * The `source` column decides what this card offers. A `template` card has NO
 * regenerate control — not a disabled one. A greyed-out button claims the
 * action exists and is unavailable right now, which invites someone to hunt
 * for the condition that enables it; there is no such condition, because
 * nothing generates these sections.
 */
export function SectionCard({
  section,
  proposalId,
  editable,
  liveState,
}: {
  section: ProposalSection;
  proposalId: string;
  editable: boolean;
  /** Set while a full generation run is in flight. */
  liveState?: "pending" | "writing" | "done" | "failed";
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const definition = sectionDefinition(section.section_key);
  const isTemplate = section.source === "template";
  const stale = stalenessMessage(section.stale_fields ?? []);
  const remaining = MAX_REGENERATIONS_PER_SECTION - section.regenerated_count;

  const isWriting = liveState === "writing" || pending;
  const isQueued = liveState === "pending";

  function handleRegenerate() {
    setMessage(null);
    setFailed(false);

    startTransition(async () => {
      const result = await regenerateSection(proposalId, section.section_key);
      setFailed(!result.ok);
      setMessage(result.message ?? null);
    });
  }

  return (
    <article
      className={cn(
        "card overflow-hidden transition-all duration-300",
        isWriting && "border-accent/30 shadow-md",
        isQueued && "opacity-55",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded text-2xs font-semibold tabular",
              isTemplate
                ? "bg-surface-sunken text-ink-subtle"
                : "bg-accent/8 text-ink-muted",
            )}
          >
            {section.position}
          </span>

          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink">
              {section.title}
            </h3>
            <p className="truncate text-2xs text-ink-subtle">
              <SectionMeta
                section={section}
                isTemplate={isTemplate}
                isWriting={isWriting}
              />
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!isTemplate && editable && (
            <>
              {section.regenerated_count > 0 && (
                <div className="hidden items-center gap-1.5 sm:flex">
                  <Meter
                    value={remaining}
                    max={MAX_REGENERATIONS_PER_SECTION}
                    tone={remaining <= 1 ? "warning" : "neutral"}
                    className="w-10"
                  />
                  <span className="text-2xs text-ink-subtle tabular">
                    {remaining} left
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={handleRegenerate}
                disabled={isWriting || remaining <= 0}
                className={buttonClass("secondary", "sm")}
                title={
                  remaining <= 0
                    ? `Regenerated ${MAX_REGENERATIONS_PER_SECTION} times already`
                    : `${remaining} regeneration${remaining === 1 ? "" : "s"} left`
                }
              >
                <Icon
                  name="refresh"
                  className={cn("h-3.5 w-3.5", isWriting && "animate-spin")}
                />
                {isWriting ? "Writing" : "Regenerate"}
              </button>
            </>
          )}

          {/* Template sections point at the intake field instead — the thing
              that actually changes them. */}
          {isTemplate && editable && (
            <a
              href="#intake"
              className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
            >
              Edit {INTAKE_FIELD_LABELS[definition.intakeField!]}
            </a>
          )}
        </div>
      </header>

      {stale && (
        <Note tone="warning" className="rounded-none border-x-0 border-t-0">
          <span className="flex items-start gap-1.5">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {stale}
              {editable && !isTemplate && " Regenerate to bring it up to date."}
            </span>
          </span>
        </Note>
      )}

      {message && (
        <Note
          tone={failed ? "danger" : "warning"}
          className="rounded-none border-x-0 border-t-0"
        >
          {message}
        </Note>
      )}

      <div className="px-4 py-4">
        {isWriting ? (
          <WritingSkeleton />
        ) : section.content ? (
          <div className="prose-proposal animate-fade whitespace-pre-wrap text-sm text-ink-muted">
            {section.content}
          </div>
        ) : isQueued ? (
          <p className="text-sm italic text-ink-subtle">Queued…</p>
        ) : (
          <p className="text-sm italic text-ink-subtle">
            Nothing here yet. Generate the proposal to fill this in.
          </p>
        )}
      </div>
    </article>
  );
}

function SectionMeta({
  section,
  isTemplate,
  isWriting,
}: {
  section: ProposalSection;
  isTemplate: boolean;
  isWriting: boolean;
}) {
  if (isWriting) return <span className="text-accent">Claude is writing…</span>;

  if (isTemplate) {
    const definition = sectionDefinition(section.section_key);
    return (
      <>From intake · {INTAKE_FIELD_LABELS[definition.intakeField!]}</>
    );
  }

  if (!section.last_generated_at) return <>Not generated yet</>;

  return (
    <>
      {section.edited_by_human ? "Edited by hand" : "Generated"}{" "}
      {new Date(section.last_generated_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}
      {section.input_tokens > 0 && (
        <span className="text-ink-subtle">
          {" · "}
          {(section.input_tokens + section.output_tokens).toLocaleString()} tokens
        </span>
      )}
    </>
  );
}

/** Shaped like paragraphs so the wait previews what is arriving. */
function WritingSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-[92%]" />
      <Skeleton className="h-3 w-[96%]" />
      <Skeleton className="h-3 w-[60%]" />
    </div>
  );
}
