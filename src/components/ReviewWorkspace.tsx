"use client";

import { useState, useTransition } from "react";

import { approveProposal, requestChanges } from "@/app/actions/review";
import { ProposalProse } from "@/components/ProposalProse";
import { Icon, Note, buttonClass, cn } from "@/components/ui/primitives";
import type { ProposalSection, SectionKey } from "@/lib/db/types";
import { stalenessMessage } from "@/lib/policy/staleness";

/**
 * Reviewing a proposal.
 *
 * The approver reads down the document and flags sections as they go — the
 * moment they notice something is the moment they know which section it is
 * about. The alternative was one note at the end, which made them write the
 * location into prose ("in the deliverables section, the third bullet…") and
 * made the salesperson find it again by reading.
 *
 * Flagged sections accumulate into the decision. Nothing is submitted until
 * the approver chooses, so marking a section is exploratory, not committal.
 */
export function ReviewWorkspace({
  proposalId,
  sections,
  canDecide,
}: {
  proposalId: string;
  sections: ProposalSection[];
  canDecide: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState<Partial<Record<SectionKey, string>>>({});
  const [open, setOpen] = useState<SectionKey | null>(null);
  const [overall, setOverall] = useState("");
  const [mode, setMode] = useState<"reading" | "approving" | "rejecting">(
    "reading",
  );
  const [error, setError] = useState<string | null>(null);

  const flagged = Object.entries(notes).filter(([, v]) => (v ?? "").trim());
  const flaggedKeys = new Set(flagged.map(([k]) => k));

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

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_21rem] lg:items-start">
      <div className="space-y-3">
        {sections.map((section) => (
          <ReviewSection
            key={section.id}
            section={section}
            canDecide={canDecide}
            note={notes[section.section_key] ?? ""}
            isOpen={open === section.section_key}
            onToggle={() =>
              setOpen(open === section.section_key ? null : section.section_key)
            }
            onNoteChange={(value) =>
              setNotes((n) => ({ ...n, [section.section_key]: value }))
            }
          />
        ))}
      </div>

      <aside className="lg:sticky lg:top-20">
        {canDecide ? (
          <div className="card overflow-hidden">
            <header className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">Your decision</h2>
              <p className="mt-0.5 text-2xs text-ink-subtle">
                Approving releases this to the salesperson to send. It does not
                send anything itself.
              </p>
            </header>

            {/* What has been flagged so far, so the decision is made with the
                objections in view rather than from memory. */}
            {flagged.length > 0 && (
              <div className="border-b border-line bg-state-changes-fill/40 px-4 py-3">
                <p className="text-2xs font-semibold uppercase tracking-wide text-[hsl(21_90%_35%)]">
                  {flagged.length} section{flagged.length === 1 ? "" : "s"} flagged
                </p>
                <ul className="mt-1.5 space-y-1">
                  {flagged.map(([key]) => {
                    const section = sections.find((s) => s.section_key === key);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(key as SectionKey);
                            document
                              .getElementById(`review-${key}`)
                              ?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }}
                          className="text-xs text-[hsl(21_90%_35%)] hover:underline"
                        >
                          {section?.title ?? key}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="p-4">
              {mode === "reading" && (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("approving")}
                    disabled={flagged.length > 0}
                    className={buttonClass("success")}
                    title={
                      flagged.length > 0
                        ? "Clear your section notes first, or send it back instead"
                        : undefined
                    }
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
                    {flagged.length > 0 && ` (${flagged.length})`}
                  </button>

                  {/* Flagging a section and then approving it would be
                      contradictory, so the interface says why rather than
                      silently discarding the notes. */}
                  {flagged.length > 0 && (
                    <p className="mt-1 text-2xs text-ink-subtle">
                      You have flagged {flagged.length} section
                      {flagged.length === 1 ? "" : "s"}. Send it back, or clear
                      the notes to approve.
                    </p>
                  )}
                </div>
              )}

              {mode === "approving" && (
                <div>
                  <label className="text-xs font-medium text-ink">
                    Anything to record? (optional)
                  </label>
                  <textarea
                    value={overall}
                    onChange={(e) => setOverall(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder="Kept with the approval permanently."
                    className={TEXTAREA}
                  />
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        act(() => approveProposal(proposalId, overall))
                      }
                      className={buttonClass("success", "sm")}
                    >
                      {pending ? "Saving…" : "Confirm approval"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("reading")}
                      className={buttonClass("secondary", "sm")}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {mode === "rejecting" && (
                <div>
                  <label className="text-xs font-medium text-ink">
                    {flagged.length > 0
                      ? "Anything else, beyond the sections you flagged?"
                      : "What needs to change?"}
                  </label>
                  <textarea
                    value={overall}
                    onChange={(e) => setOverall(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder={
                      flagged.length > 0
                        ? "Optional — your section notes are already attached."
                        : "Be specific. The salesperson works from this."
                    }
                    className={TEXTAREA}
                  />
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      disabled={
                        pending ||
                        (flagged.length === 0 && overall.trim() === "")
                      }
                      onClick={() =>
                        act(() =>
                          requestChanges(
                            proposalId,
                            overall,
                            flagged.map(([key, note]) => ({
                              sectionKey: key as SectionKey,
                              note: note ?? "",
                            })),
                          ),
                        )
                      }
                      className={buttonClass("primary", "sm")}
                    >
                      {pending ? "Sending…" : "Send it back"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("reading")}
                      className={buttonClass("secondary", "sm")}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <Note tone="danger" className="mt-3">
                  {error}
                </Note>
              )}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

const TEXTAREA =
  "mt-1.5 block w-full rounded border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-sm transition-colors placeholder:text-ink-subtle focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10";

function ReviewSection({
  section,
  canDecide,
  note,
  isOpen,
  onToggle,
  onNoteChange,
}: {
  section: ProposalSection;
  canDecide: boolean;
  note: string;
  isOpen: boolean;
  onToggle: () => void;
  onNoteChange: (value: string) => void;
}) {
  const stale = stalenessMessage(section.stale_fields ?? []);
  const flagged = note.trim() !== "";

  return (
    <article
      id={`review-${section.section_key}`}
      className={cn(
        "card group/rev overflow-hidden scroll-mt-24 transition-colors",
        flagged && "border-state-changes/40",
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded text-2xs font-semibold tabular",
              flagged
                ? "bg-state-changes-fill text-[hsl(21_90%_35%)]"
                : "bg-surface-sunken text-ink-subtle",
            )}
          >
            {section.position}
          </span>
          <h2 className="truncate text-sm font-semibold text-ink">
            {section.title}
          </h2>
        </div>

        {canDecide && (
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              buttonClass(flagged ? "secondary" : "ghost", "sm"),
              !flagged &&
                !isOpen &&
                "opacity-0 focus-visible:opacity-100 group-hover/rev:opacity-100",
            )}
          >
            <Icon name={flagged ? "alert" : "plus"} className="h-3.5 w-3.5" />
            {flagged ? "Flagged" : "Flag this section"}
          </button>
        )}
      </header>

      {/* The approver sees the same staleness markers the editor shows. They
          are the person separation of duties exists to protect, and hiding
          that a section predates its own inputs would defeat the point. */}
      {stale && (
        <Note tone="warning" className="rounded-none border-x-0 border-t-0">
          <span className="flex items-start gap-1.5">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{stale}</span>
          </span>
        </Note>
      )}

      {(isOpen || flagged) && canDecide && (
        <div className="border-b border-line bg-state-changes-fill/30 px-4 py-3">
          <label className="text-2xs font-semibold uppercase tracking-wide text-[hsl(21_90%_35%)]">
            What needs to change here?
          </label>
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            rows={2}
            autoFocus={isOpen}
            placeholder="e.g. This promises onboarding support we did not scope."
            className={TEXTAREA}
          />
          {flagged && (
            <button
              type="button"
              onClick={() => onNoteChange("")}
              className="mt-1.5 text-2xs text-ink-muted hover:text-ink hover:underline"
            >
              Remove this note
            </button>
          )}
        </div>
      )}

      <div className="px-4 py-4">
        {section.content ? (
          <ProposalProse content={section.content} className="text-sm" />
        ) : (
          <p className="text-sm italic text-ink-subtle">This section is empty.</p>
        )}
      </div>
    </article>
  );
}
