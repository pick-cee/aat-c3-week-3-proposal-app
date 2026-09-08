"use client";

import { useState } from "react";

import { GenerateButton, type SectionProgress } from "@/components/GenerateButton";
import { SectionCard } from "@/components/SectionCard";
import { Eyebrow, cn } from "@/components/ui/primitives";
import type { FieldGap, ProposalSection } from "@/lib/db/types";

/**
 * The sections, plus the control that generates them.
 *
 * These share a client boundary so the generate button can report which
 * section is being written and each card can show it — the whole point of
 * driving generation one call at a time.
 */
export function ProposalWorkspace({
  proposalId,
  sections,
  editable,
  blocking,
  warnings,
  spend,
}: {
  proposalId: string;
  sections: ProposalSection[];
  editable: boolean;
  blocking: FieldGap[];
  warnings: FieldGap[];
  spend: number;
}) {
  const [progress, setProgress] = useState<SectionProgress>({});

  const written = sections.filter((s) => s.content).length;
  const isRunning = Object.values(progress).some((s) => s === "writing");

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>The proposal</Eyebrow>
          <p className="mt-1 text-sm text-ink-muted">
            <span className="font-medium text-ink tabular">
              {written} of {sections.length}
            </span>{" "}
            sections written
            {spend > 0 && (
              <>
                <span className="mx-1.5 text-ink-subtle">·</span>
                {/* Summed from activity_log, so discarded attempts are
                    included in what the salesperson sees. */}
                <span
                  className="tabular"
                  title="Includes attempts that were rejected and retried"
                >
                  ${spend.toFixed(3)} spent
                </span>
              </>
            )}
          </p>
        </div>

        {editable && (
          <GenerateButton
            proposalId={proposalId}
            blocking={blocking}
            warnings={warnings}
            hasContent={written > 0}
            onProgress={setProgress}
          />
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
          />
        ))}
      </div>
    </section>
  );
}
