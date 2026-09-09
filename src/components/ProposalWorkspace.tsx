"use client";

import Link from "next/link";
import { useState } from "react";

import {
  GenerateButton,
  type SectionProgress,
  type SectionResults,
} from "@/components/GenerateButton";
import { SectionCard } from "@/components/SectionCard";
import { Icon, Meter, cn } from "@/components/ui/primitives";
import { INTAKE_FIELD_LABELS, type FieldGap, type ProposalSection } from "@/lib/db/types";

/**
 * The document, and the one control that writes it.
 *
 * These share a client boundary so the generate button can report which
 * section is being written and each card can show it.
 *
 * The generate control sits ABOVE the sections rather than below them. It is
 * the action the page exists for, and burying it under six cards meant the
 * first thing a salesperson saw was six identical Regenerate buttons on empty
 * sections — six ways to do a thing that had not happened yet.
 */
export function ProposalWorkspace({
  proposalId,
  sections,
  editable,
  blocking,
  warnings,
  spend,
  autoStart = false,
  sectionFeedback,
}: {
  proposalId: string;
  sections: ProposalSection[];
  editable: boolean;
  blocking: FieldGap[];
  warnings: FieldGap[];
  spend: number;
  /** Begin writing on arrival — see the editor page. */
  autoStart?: boolean;
  /**
   * What the approver said about each section, from the latest rejection.
   * Shown on the card it concerns rather than as one banner the salesperson
   * has to map onto the document by reading.
   */
  sectionFeedback?: Map<string, string>;
}) {
  const [progress, setProgress] = useState<SectionProgress>({});

  /**
   * Text that arrived during this run, before the server round-trip that would
   * otherwise be the only way to see it. Cleared implicitly on navigation,
   * because by then the database is the source of truth again.
   */
  const [live, setLive] = useState<SectionResults>({});

  /**
   * Progress counts only what Claude actually writes.
   *
   * Timeline and Pricing are rendered from intake the moment a proposal
   * exists, so counting all six made a brand-new proposal read "2 of 6
   * written" — and told the button to say "Regenerate all sections" before
   * anything had been generated once.
   */
  const generated = sections.filter((s) => s.source === "generated");
  // Counts what is on screen, which during a run includes text that has
  // arrived but not yet been re-fetched.
  const written = generated.filter(
    (s) => s.content || live[s.section_key]?.content,
  ).length;
  const hasContent = written > 0;

  const isRunning = Object.values(progress).some((s) => s === "writing");
  const isBlocked = blocking.length > 0;

  return (
    <section>
      {/* The action bar. One thing to do, and if it cannot be done, why. */}
      <div
        className={cn(
          "rounded-lg border p-4",
          isBlocked
            ? "border-state-failed/25 bg-state-failed-fill/30"
            : "border-line bg-surface",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-semibold text-ink">The proposal</h2>
              <span className="text-2xs text-ink-subtle tabular">
                {written} of {generated.length} written
              </span>
              {spend > 0 && (
                <span
                  className="text-2xs text-ink-subtle tabular"
                  title="Includes attempts that were rejected and retried"
                >
                  ${spend.toFixed(3)}
                </span>
              )}
            </div>

            <Meter
              value={written}
              max={generated.length}
              tone={
                isBlocked
                  ? "danger"
                  : written === generated.length
                    ? "positive"
                    : "neutral"
              }
              className="mt-2 max-w-[14rem]"
            />
          </div>

          {editable && !isBlocked && (
            <GenerateButton
              proposalId={proposalId}
              blocking={blocking}
              warnings={warnings}
              hasContent={hasContent}
              onProgress={setProgress}
              onResult={setLive}
              autoStart={autoStart}
            />
          )}
        </div>

        {/*
          The blocked reason lives here, attached to the control it blocks,
          with a link straight to the fix. Previously this was a separate red
          panel that named the missing fields without saying where to put them.
        */}
        {editable && isBlocked && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-state-failed/15 pt-3">
            <p className="flex items-start gap-1.5 text-sm text-[hsl(0_74%_35%)]">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Claude needs{" "}
                <span className="font-medium">
                  {blocking.map((g) => INTAKE_FIELD_LABELS[g.field]).join(", ")}
                </span>{" "}
                before it can write anything.
              </span>
            </p>
            <Link
              href={`/proposals/${proposalId}/confirm`}
              className="ml-auto shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-ink-inverse transition-colors hover:bg-accent-hover"
            >
              Add {blocking.length === 1 ? "it" : "them"} now
            </Link>
          </div>
        )}
      </div>

      <div className={cn("mt-4 space-y-3", !isRunning && "stagger")}>
        {sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            proposalId={proposalId}
            editable={editable}
            liveState={progress[section.section_key]}
            liveContent={live[section.section_key]?.content}
            liveWarnings={live[section.section_key]?.warnings}
            approverNote={sectionFeedback?.get(section.section_key)}
          />
        ))}
      </div>
    </section>
  );
}
