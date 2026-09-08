"use client";

import { useState } from "react";

import { Icon, buttonClass, cn } from "@/components/ui/primitives";
import {
  INTAKE_FIELD_KEYS,
  INTAKE_FIELD_LABELS,
  type FieldProvenance,
  type FieldTier,
  type IntakeFields,
} from "@/lib/db/types";
import { FIELD_TIERS, assessReadiness } from "@/lib/policy/fields";

/**
 * The intake form, with the three tiers visible as you fill it.
 *
 * Blocked fields are marked before you try to submit, not after. This shares
 * `policy/fields.ts` with the server: the form showing a field as blocking is a
 * courtesy, the server refusing to generate without it is the actual rule, and
 * both read the same table so they cannot disagree.
 */

const FIELD_HINTS: Partial<Record<keyof IntakeFields, string>> = {
  client_needs_summary: "The problem the client wants to solve.",
  project_scope: "What they want built or delivered.",
  goals_and_objectives: "The outcomes they are after.",
  recommended_services: "What we are proposing to do.",
  proposed_timeline: "Duration, phases, or a delivery window.",
  estimated_pricing: "A price, a range, or pricing notes.",
};

const LONG_FIELDS = new Set<keyof IntakeFields>([
  "client_needs_summary",
  "project_scope",
  "goals_and_objectives",
  "recommended_services",
]);

const TIER_BADGE: Record<FieldTier, { label: string; className: string }> = {
  block: {
    label: "Required",
    className: "bg-state-failed-fill text-[hsl(0_74%_35%)]",
  },
  warn: {
    label: "Shows [To be confirmed]",
    className: "bg-state-review-fill text-[hsl(32_81%_29%)]",
  },
  mark: { label: "Optional", className: "bg-surface-sunken text-ink-subtle" },
};

/**
 * ONE form, used by three paths: create, edit, and confirm-after-extraction.
 *
 * The confirm screen is this component with `provenance` supplied — not a
 * second form that happens to look similar. Two intake forms would drift the
 * moment a field or a tier changed on one of them, and the divergence would be
 * invisible until a required field stopped being required on one path.
 */
export function IntakeForm({
  action,
  initial,
  submitLabel = "Create proposal",
  provenance,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial?: Partial<IntakeFields>;
  submitLabel?: string;
  /** Source phrases for extracted values. Absent for hand-typed fields. */
  provenance?: Partial<Record<keyof IntakeFields, FieldProvenance>>;
}) {
  const [values, setValues] = useState<Partial<IntakeFields>>(initial ?? {});

  // Recomputed as you type, so the consequence of leaving a field empty is
  // visible while you can still do something about it.
  const readiness = assessReadiness(values, true);
  const blockingFields = new Set(readiness.blocking.map((g) => g.field));

  /**
   * A source phrase stops being shown the moment the value it justifies is
   * edited. Keeping it visible would attach a quotation to a number nobody
   * extracted — the server drops the entry on write for the same reason.
   */
  function sourceFor(field: keyof IntakeFields): string | null {
    const entry = provenance?.[field];
    if (!entry) return null;

    const current = values[field];
    const original = initial?.[field];

    if (current !== undefined && (current ?? "").trim() !== (original ?? "").trim()) {
      return null;
    }

    return entry.source;
  }

  return (
    <form action={action} className="space-y-5">
      <div className="card grid gap-5 p-5 sm:grid-cols-2">
        {INTAKE_FIELD_KEYS.map((field) => {
          const tier = FIELD_TIERS[field];
          const badge = TIER_BADGE[tier];
          const isLong = LONG_FIELDS.has(field);
          const isBlocking = blockingFields.has(field);

          return (
            <div key={field} className={isLong ? "sm:col-span-2" : undefined}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label
                  htmlFor={field}
                  className="text-sm font-medium text-ink"
                >
                  {INTAKE_FIELD_LABELS[field]}
                </label>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-2xs font-medium",
                    badge.className,
                  )}
                >
                  {badge.label}
                </span>
              </div>

              {FIELD_HINTS[field] && (
                <p className="mt-1 text-xs text-ink-subtle">
                  {FIELD_HINTS[field]}
                </p>
              )}

              {isLong ? (
                <textarea
                  id={field}
                  name={field}
                  rows={3}
                  defaultValue={initial?.[field] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field]: e.target.value }))
                  }
                  className={inputClass(isBlocking)}
                />
              ) : (
                <input
                  id={field}
                  name={field}
                  type={
                    field === "client_email"
                      ? "email"
                      : field === "date_of_call"
                        ? "date"
                        : "text"
                  }
                  defaultValue={initial?.[field] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field]: e.target.value }))
                  }
                  className={inputClass(isBlocking)}
                />
              )}

              {/*
                The evidence, directly under the value it justifies. This is
                what makes the confirm screen real checking rather than a
                rubber stamp — a pre-filled form with no provenance invites
                scrolling to the bottom and clicking through.
              */}
              {sourceFor(field) && (
                <p className="mt-1.5 flex gap-1.5 text-xs text-ink-subtle animate-fade">
                  <Icon name="file" className="mt-px h-3 w-3 shrink-0" />
                  <span>
                    From your notes:{" "}
                    <span className="italic">
                      &ldquo;{sourceFor(field)}&rdquo;
                    </span>
                  </span>
                </p>
              )}

              {isBlocking && (
                <p className="mt-1 flex items-center gap-1 text-xs text-state-failed animate-fade">
                  <Icon name="alert" className="h-3 w-3" />
                  There is no proposal without this.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className={buttonClass("primary")}>
          {submitLabel}
        </button>

        {/*
          Deliberately not disabled. The form saves a draft; generation is what
          the Block tier gates, and that gate is on the editor with its own
          stated reason. Disabling save here would trap someone mid-intake who
          simply has not finished typing.
        */}
        {readiness.blocking.length > 0 && (
          <p className="text-sm text-ink-muted">
            {readiness.blocking.length} required{" "}
            {readiness.blocking.length === 1 ? "field" : "fields"} still empty —
            save now, generate once they are filled.
          </p>
        )}
      </div>
    </form>
  );
}

function inputClass(isBlocking: boolean): string {
  return cn(
    "mt-1.5 block w-full rounded border bg-surface px-3 py-2 text-sm text-ink shadow-sm",
    "transition-colors placeholder:text-ink-subtle",
    "focus:outline-none focus:ring-2",
    isBlocking
      ? "border-state-failed/40 focus:border-state-failed focus:ring-state-failed/15"
      : "border-line-strong focus:border-accent/40 focus:ring-accent/10",
  );
}
