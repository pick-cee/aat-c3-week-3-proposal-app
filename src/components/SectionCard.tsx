"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { regenerateSection, type SectionWarning } from "@/app/actions/generate";
import { saveSectionContent } from "@/app/actions/sections";
import { ProposalProse } from "@/components/ProposalProse";
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
import { formatDateTime, formatNumber } from "@/lib/format";

/**
 * One section, as a card.
 *
 * Three things a salesperson can do here, in increasing cost: read it, fix a
 * word by hand, or spend a model call regenerating it. The cheapest fix is the
 * most prominent — a name warning is a link that puts the cursor on the
 * offending word, because "Northwind" needing to be "Northwind Logistics" is a
 * five-second edit and regenerating four paragraphs to get it is absurd.
 */
export function SectionCard({
  section,
  proposalId,
  editable,
  liveState,
  liveContent,
  liveWarnings,
  approverNote,
}: {
  section: ProposalSection;
  proposalId: string;
  editable: boolean;
  /** Set while a full generation run is in flight. */
  liveState?: "pending" | "writing" | "done" | "failed";
  /** Text that arrived this run, before the server round-trip. */
  liveContent?: string;
  liveWarnings?: SectionWarning[];
  /** What the approver asked to change about THIS section. */
  approverNote?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.content ?? "");
  const [warnings, setWarnings] = useState<SectionWarning[]>(liveWarnings ?? []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const definition = sectionDefinition(section.section_key);
  const isTemplate = section.source === "template";
  const stale = stalenessMessage(section.stale_fields ?? []);
  const remaining = MAX_REGENERATIONS_PER_SECTION - section.regenerated_count;

  // Live text wins while a run is in flight; the row catches up on refresh.
  const content = liveContent ?? section.content;

  const isWriting = liveState === "writing" || pending;
  const isQueued = liveState === "pending";
  const canRegenerate = editable && !isTemplate && Boolean(content);

  useEffect(() => {
    if (liveWarnings) setWarnings(liveWarnings);
  }, [liveWarnings]);

  // Keep the draft in step when the server sends new text.
  useEffect(() => {
    if (!editing) setDraft(content ?? "");
  }, [content, editing]);

  function handleRegenerate() {
    setMessage(null);
    setFailed(false);

    startTransition(async () => {
      const result = await regenerateSection(proposalId, section.section_key);
      setFailed(!result.ok);
      setMessage(result.message ?? null);
      setWarnings(result.warnings ?? []);
      if (result.content) setDraft(result.content);
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);

    const result = await saveSectionContent(
      proposalId,
      section.section_key,
      draft,
    );

    setSaving(false);
    setFailed(!result.ok);
    setMessage(result.message ?? null);

    if (result.ok) {
      setEditing(false);
      // A hand-edit answers whatever the warning was about.
      setWarnings([]);
    }
  }

  /**
   * Put the cursor on the text a warning concerns.
   *
   * The warning says a name reads differently from the intake. Finding it by
   * eye in four paragraphs is the tedious part, so this opens the editor,
   * selects the phrase, and scrolls to it — turning a warning into the first
   * keystroke of the fix.
   */
  function jumpToWarning(warning: SectionWarning) {
    setEditing(true);

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;

      el.focus();

      // Look for the expected name first; if the model omitted it entirely
      // there is nothing to select, so land at the top and let them read.
      const haystack = el.value.toLowerCase();
      const firstWord = warning.expected.toLowerCase().split(" ")[0] ?? "";
      const index =
        haystack.indexOf(warning.expected.toLowerCase()) !== -1
          ? haystack.indexOf(warning.expected.toLowerCase())
          : firstWord.length >= 3
            ? haystack.indexOf(firstWord)
            : -1;

      if (index === -1) {
        el.setSelectionRange(0, 0);
        return;
      }

      const end =
        haystack.slice(index).startsWith(warning.expected.toLowerCase())
          ? index + warning.expected.length
          : index + firstWord.length;

      el.setSelectionRange(index, end);

      // Rough scroll to the selection: textareas expose no API for this, so
      // measure by line and nudge the scroll position.
      const before = el.value.slice(0, index).split("\n").length;
      const lineHeight = parseInt(getComputedStyle(el).lineHeight || "20", 10);
      el.scrollTop = Math.max(0, (before - 3) * lineHeight);
    });
  }

  return (
    <article
      id={`section-${section.section_key}`}
      className={cn(
        "card group/section overflow-hidden scroll-mt-24 transition-all duration-300",
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
                hasContent={Boolean(content)}
              />
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {editable && !isTemplate && content && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(
                buttonClass("ghost", "sm"),
                "opacity-0 focus-visible:opacity-100 group-hover/section:opacity-100",
              )}
            >
              Edit
            </button>
          )}

          {canRegenerate && !editing && (
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
                className={cn(
                  buttonClass("secondary", "sm"),
                  "opacity-0 focus-visible:opacity-100 group-hover/section:opacity-100",
                  isWriting && "opacity-100",
                )}
                title={
                  remaining <= 0
                    ? `Regenerated ${MAX_REGENERATIONS_PER_SECTION} times already`
                    : `Rewrite just this section · ${remaining} left`
                }
              >
                <Icon
                  name="refresh"
                  className={cn("h-3.5 w-3.5", isWriting && "animate-spin")}
                />
                {isWriting ? "Writing" : "Rewrite"}
              </button>
            </>
          )}

          {isTemplate && editable && (
            <a
              href={`/proposals/${proposalId}/confirm`}
              className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
            >
              Edit {INTAKE_FIELD_LABELS[definition.intakeField!]}
            </a>
          )}
        </div>
      </header>

      {/*
        The approver's note about this specific section, at the top of the card
        it concerns. Previously this was one banner covering the whole proposal,
        which made the salesperson re-read the document to find what was meant.
      */}
      {approverNote && (
        <div className="border-b border-state-changes/30 bg-state-changes-fill/40 px-4 py-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-[hsl(21_90%_35%)]">
            The approver asked for a change here
          </p>
          <p className="mt-1 text-sm text-ink">{approverNote}</p>
        </div>
      )}

      {stale && (
        <Note tone="warning" className="rounded-none border-x-0 border-t-0">
          <span className="flex items-start gap-1.5">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {stale}
              {editable && !isTemplate && " Rewrite to bring it up to date."}
            </span>
          </span>
        </Note>
      )}

      {/*
        A warning is a link to the fix, not a notice. Clicking it opens the
        editor with the phrase selected — the tedious part was finding it.
      */}
      {warnings.length > 0 && editable && !isTemplate && (
        <div className="border-b border-state-review/25 bg-state-review-fill/40 px-4 py-2.5">
          <p className="text-2xs font-medium uppercase tracking-wide text-[hsl(32_81%_29%)]">
            Worth checking
          </p>
          <ul className="mt-1.5 space-y-1">
            {warnings.map((warning) => (
              <li key={warning.field}>
                <button
                  type="button"
                  onClick={() => jumpToWarning(warning)}
                  className="group/warn flex items-start gap-1.5 text-left text-xs text-[hsl(32_81%_29%)] hover:underline"
                >
                  <Icon name="alert" className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {warning.note}{" "}
                    <span className="font-medium underline-offset-2 group-hover/warn:underline">
                      Fix it here →
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
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
        ) : editing ? (
          <div>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(20, Math.max(6, draft.split("\n").length + 2))}
              className="block w-full rounded border border-line-strong bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
            />
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className={buttonClass("primary", "sm")}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(content ?? "");
                }}
                className={buttonClass("secondary", "sm")}
              >
                Cancel
              </button>
              <p className="text-2xs text-ink-subtle">
                Editing by hand costs nothing and keeps the rest of the section.
              </p>
            </div>
          </div>
        ) : content ? (
          <ProposalProse content={content} className="animate-fade text-sm" />
        ) : isQueued ? (
          <p className="flex items-center gap-1.5 text-sm text-ink-subtle">
            <span className="h-1.5 w-1.5 rounded-full bg-ink-subtle" />
            Waiting its turn
          </p>
        ) : (
          <p className="text-sm italic text-ink-subtle">
            {isTemplate
              ? "Fill in the intake field above and this writes itself."
              : "Not written yet."}
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
  hasContent,
}: {
  section: ProposalSection;
  isTemplate: boolean;
  isWriting: boolean;
  hasContent: boolean;
}) {
  if (isWriting) return <span className="text-accent">Claude is writing…</span>;

  if (isTemplate) {
    const definition = sectionDefinition(section.section_key);
    return <>From intake · {INTAKE_FIELD_LABELS[definition.intakeField!]}</>;
  }

  if (!section.last_generated_at) {
    return hasContent ? <>Just written</> : <>Not written yet</>;
  }

  return (
    <>
      {section.edited_by_human ? "Edited by hand" : "Written"}{" "}
      {formatDateTime(section.last_generated_at)}
      {section.input_tokens > 0 && (
        <span className="text-ink-subtle">
          {" · "}
          {formatNumber((section.input_tokens + section.output_tokens))} tokens
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
