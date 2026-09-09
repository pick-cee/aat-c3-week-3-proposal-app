"use client";

import { useState } from "react";

import { Icon, cn } from "@/components/ui/primitives";
import {
  INTAKE_FIELD_KEYS,
  INTAKE_FIELD_LABELS,
  type Approval,
  type ApprovalComment,
  type Proposal,
  type ProposalSection,
  type SupportingMaterial,
} from "@/lib/db/types";
import { formatDateTime } from "@/lib/format";

/**
 * What the approver checks the proposal against.
 *
 * Laid out horizontally under the document rather than as a tall column beside
 * it: eleven intake fields stacked in a sidebar pushed the decision controls
 * off screen, and the decision is the thing this page exists for.
 *
 * Tabs because all three matter and none needs to be visible at once.
 */
type Tab = "intake" | "materials" | "history";

export function ReviewReference({
  proposal,
  materials,
  approvals,
  comments,
  sections,
}: {
  proposal: Proposal;
  materials: SupportingMaterial[];
  approvals: Approval[];
  comments: ApprovalComment[];
  sections: ProposalSection[];
}) {
  const [tab, setTab] = useState<Tab>("intake");

  const TABS: Array<{
    id: Tab;
    label: string;
    icon: Parameters<typeof Icon>[0]["name"];
    badge?: number;
  }> = [
    { id: "intake", label: "What was agreed", icon: "file" },
    {
      id: "materials",
      label: "Files the client sent",
      icon: "plus",
      badge: materials.length || undefined,
    },
    {
      id: "history",
      label: "Earlier decisions",
      icon: "clock",
      badge: approvals.length || undefined,
    },
  ];

  return (
    <div className="card overflow-hidden">
      <div
        role="tablist"
        aria-label="Reference"
        className="flex border-b border-line bg-surface-sunken/50"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors",
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
          </button>
        ))}
      </div>

      <div className="animate-fade p-5">
        {tab === "intake" && (
          <>
            <p className="text-2xs text-ink-subtle">
              Straight from the salesperson&apos;s notes. Every price and date
              in the document came from here — a figure in the proposal that is
              not on this list should not be there.
            </p>
            <dl className="mt-4 grid gap-x-6 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {INTAKE_FIELD_KEYS.map((field) => {
                const value = proposal[field];
                const provenance = proposal.field_provenance?.[field];

                return (
                  <div key={field}>
                    <dt className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                      {INTAKE_FIELD_LABELS[field]}
                    </dt>
                    <dd
                      className={cn(
                        "mt-0.5 text-sm",
                        value ? "text-ink" : "italic text-ink-subtle",
                      )}
                    >
                      {value ??
                        (provenance?.reason
                          ? "Incomplete in the notes"
                          : "Not provided")}
                    </dd>
                    {/* Where it came from, so the approver can see the value
                        was taken from the call rather than invented later. */}
                    {value && provenance && !provenance.reason && (
                      <p className="mt-0.5 line-clamp-2 text-2xs italic text-ink-subtle">
                        &ldquo;{provenance.source}&rdquo;
                      </p>
                    )}
                    {!value && provenance?.reason && (
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        <span className="italic">
                          &ldquo;{provenance.source}&rdquo;
                        </span>{" "}
                        — {provenance.reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </dl>
          </>
        )}

        {tab === "materials" && (
          <>
            {materials.length === 0 ? (
              <p className="text-sm text-ink-subtle">
                No supporting files were uploaded for this proposal.
              </p>
            ) : (
              <ul className="space-y-2">
                {materials.map((material) => (
                  <li
                    key={material.id}
                    className="flex items-start gap-3 rounded border border-line px-3.5 py-2.5"
                  >
                    <Icon
                      name="file"
                      className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {material.filename}
                      </p>
                      <p className="text-2xs text-ink-subtle">
                        {material.summarized
                          ? "Read and used when writing this proposal"
                          : "Stored, but not used in the writing"}
                      </p>
                      {material.summary && (
                        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                          {material.summary}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            {approvals.length === 0 ? (
              <p className="text-sm text-ink-subtle">
                This is the first time this proposal has been reviewed.
              </p>
            ) : (
              <ol className="space-y-4">
                {approvals.map((approval) => {
                  const mine = comments.filter(
                    (c) => c.approval_id === approval.id,
                  );

                  return (
                    <li
                      key={approval.id}
                      className="border-l-2 border-line pl-3.5"
                    >
                      <p className="text-sm">
                        <span
                          className={cn(
                            "font-medium",
                            approval.decision === "approved"
                              ? "text-state-approved"
                              : "text-state-changes",
                          )}
                        >
                          {approval.decision === "approved"
                            ? "Approved"
                            : "Changes requested"}
                        </span>
                        <span className="text-ink-muted">
                          {" "}
                          by {approval.approver_name}
                        </span>
                      </p>
                      <p className="text-2xs text-ink-subtle tabular">
                        {formatDateTime(approval.created_at)}
                      </p>

                      {approval.note && (
                        <p className="mt-1.5 text-sm text-ink-muted">
                          {approval.note}
                        </p>
                      )}

                      {/* The per-section notes from that round, named by
                          section so a later reviewer can see exactly what was
                          objected to without re-reading the document. */}
                      {mine.length > 0 && (
                        <ul className="mt-2 space-y-1.5">
                          {mine.map((comment) => {
                            const section = sections.find(
                              (s) => s.section_key === comment.section_key,
                            );
                            return (
                              <li
                                key={comment.id}
                                className="rounded bg-surface-sunken px-2.5 py-1.5 text-xs"
                              >
                                <span className="font-medium text-ink">
                                  {section?.title ?? comment.section_key}
                                </span>
                                <span className="text-ink-muted">
                                  {" — "}
                                  {comment.note}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </div>
    </div>
  );
}
