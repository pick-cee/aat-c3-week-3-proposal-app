"use client";

import { useState } from "react";

import { ActivityTimeline } from "@/components/ActivityTimeline";
import { IntakePanel } from "@/components/IntakePanel";
import { MaterialList } from "@/components/MaterialList";
import { MaterialUploader } from "@/components/MaterialUploader";
import { Icon, cn } from "@/components/ui/primitives";
import type {
  ActivityLogEntry,
  Proposal,
  SupportingMaterial,
} from "@/lib/db/types";

/**
 * The reference material, as one panel with three tabs.
 *
 * All three of these matter — what was recorded, what was uploaded, what has
 * happened. But stacked, they were three competing panels beside a document
 * that is the actual work, and the page read as a pile of things rather than
 * one task.
 *
 * Tabs say: this is one region, showing one thing at a time, and you choose
 * which. The badge on each tab means nothing is hidden — a salesperson can see
 * there are two files without opening the tab.
 */
type Tab = "intake" | "materials" | "activity";

export function ProposalSidebar({
  proposal,
  materials,
  activity,
  editable,
}: {
  proposal: Proposal;
  materials: SupportingMaterial[];
  activity: ActivityLogEntry[];
  editable: boolean;
}) {
  const [tab, setTab] = useState<Tab>("intake");

  const usable = materials.filter((m) => m.summarized).length;

  const TABS: Array<{
    id: Tab;
    label: string;
    icon: Parameters<typeof Icon>[0]["name"];
    badge?: number;
  }> = [
    { id: "intake", label: "Details", icon: "file" },
    {
      id: "materials",
      label: "Files",
      icon: "plus",
      badge: materials.length || undefined,
    },
    {
      id: "activity",
      label: "History",
      icon: "clock",
      badge: activity.length || undefined,
    },
  ];

  return (
    <div className="card overflow-hidden">
      <div
        role="tablist"
        aria-label="Proposal reference"
        className="flex border-b border-line bg-surface-sunken/50"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors",
              tab === t.id
                ? "bg-surface text-ink"
                : "text-ink-muted hover:bg-surface/60 hover:text-ink",
            )}
          >
            <Icon name={t.icon} className="h-3.5 w-3.5" />
            {t.label}
            {t.badge !== undefined && (
              <span className="rounded-full bg-surface-sunken px-1.5 text-2xs tabular">
                {t.badge}
              </span>
            )}
            {tab === t.id && (
              <span className="absolute inset-x-0 -bottom-px h-px bg-surface" />
            )}
          </button>
        ))}
      </div>

      <div className="animate-fade">
        {tab === "intake" && (
          <IntakePanel proposal={proposal} editable={editable} chromeless />
        )}

        {tab === "materials" && (
          <div className="space-y-3 p-4">
            {materials.length > 0 ? (
              <>
                <p className="text-2xs text-ink-subtle">
                  {usable} of {materials.length} summarized and used in writing
                </p>
                <MaterialList materials={materials} editable={editable} />
              </>
            ) : (
              <p className="text-sm text-ink-subtle">
                No files uploaded. Anything the client sent — a brief, a
                requirements doc — makes the proposal more specific.
              </p>
            )}
            {editable && <MaterialUploader proposalId={proposal.id} />}
          </div>
        )}

        {tab === "activity" && (
          <div className="p-3">
            <ActivityTimeline entries={activity} />
          </div>
        )}
      </div>
    </div>
  );
}
