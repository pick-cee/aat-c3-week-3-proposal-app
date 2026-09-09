"use client";

import Link from "next/link";
import { useState } from "react";

import { Icon, Meter, buttonClass, cn } from "@/components/ui/primitives";
import {
  INTAKE_FIELD_KEYS,
  INTAKE_FIELD_LABELS,
  type FieldProvenance,
  type FieldTier,
  type IntakeFields,
  type Proposal,
} from "@/lib/db/types";
import { FIELD_TIERS } from "@/lib/policy/fields";

/**
 * The intake, as a compact always-visible panel rather than a form at the
 * bottom of the page.
 *
 * Intake is UPSTREAM of everything else: it decides whether generation is
 * allowed, what the template sections say, and which sections go stale. Putting
 * it below the activity log meant the thing that unblocks the page was the last
 * thing anyone found — a salesperson could sit looking at "Generation is
 * disabled" with the fix three screens down.
 *
 * So it reads at a glance here, and the full form is one click away.
 */
export function IntakePanel({
  proposal,
  editable,
  chromeless = false,
}: {
  proposal: Proposal;
  editable: boolean;
  /** Drop the card border and heading when nested inside one. */
  chromeless?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const missing = INTAKE_FIELD_KEYS.filter(
    (field) => !(proposal[field] ?? "").toString().trim(),
  );
  const missingByTier = (tier: FieldTier) =>
    missing.filter((f) => FIELD_TIERS[f] === tier);

  const blocking = missingByTier("block");
  const warnings = missingByTier("warn");
  const filled = INTAKE_FIELD_KEYS.length - missing.length;

  // The fields worth seeing without expanding: who it is for, and the two
  // commercial terms that go into the document verbatim.
  const KEY_FIELDS = [
    "client_name",
    "company_name",
    "estimated_pricing",
    "proposed_timeline",
  ] as const;

  const shown = expanded ? INTAKE_FIELD_KEYS : KEY_FIELDS;

  return (
    <section
      className={cn(
        "overflow-hidden",
        !chromeless && "card",
        !chromeless && blocking.length > 0 && "border-state-failed/30",
      )}
    >
      {!chromeless && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">
              What the salesperson recorded
            </h2>
            <p className="mt-0.5 text-2xs text-ink-subtle">
              Inserted into the document exactly as typed
            </p>
          </div>

          {editable && (
            <Link
              href={`/proposals/${proposal.id}/confirm`}
              className={buttonClass("secondary", "sm")}
            >
              Edit
            </Link>
          )}
        </header>
      )}

      <div className="border-b border-line px-4 py-3">
        {chromeless && editable && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-2xs text-ink-subtle">
              Inserted into the document exactly as typed
            </p>
            <Link
              href={`/proposals/${proposal.id}/confirm`}
              className={buttonClass("secondary", "sm")}
            >
              Edit
            </Link>
          </div>
        )}
        <div className="flex items-center gap-2.5">
          <Meter
            value={filled}
            max={INTAKE_FIELD_KEYS.length}
            tone={
              blocking.length > 0
                ? "danger"
                : warnings.length > 0
                  ? "warning"
                  : "positive"
            }
            className="flex-1"
          />
          <span className="shrink-0 text-2xs text-ink-subtle tabular">
            {filled}/{INTAKE_FIELD_KEYS.length}
          </span>
        </div>

        {/*
          The reason generation is blocked, next to the thing that fixes it —
          not in a separate banner elsewhere on the page.
        */}
        {blocking.length > 0 && (
          <p className="mt-2.5 flex items-start gap-1.5 text-xs text-state-failed">
            <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-medium">
                {blocking.map((f) => INTAKE_FIELD_LABELS[f]).join(", ")}
              </span>{" "}
              {blocking.length === 1 ? "is" : "are"} required before anything can
              be written.
            </span>
          </p>
        )}

        {blocking.length === 0 && warnings.length > 0 && (
          <p className="mt-2.5 flex items-start gap-1.5 text-xs text-[hsl(32_81%_29%)]">
            <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {warnings.map((f) => INTAKE_FIELD_LABELS[f]).join(", ")} will show
              as <span className="font-medium">[To be confirmed]</span>.
            </span>
          </p>
        )}
      </div>

      <dl className="divide-y divide-line">
        {shown.map((field) => (
          <IntakeRow
            key={field}
            field={field}
            value={proposal[field]}
            provenance={proposal.field_provenance?.[field]}
          />
        ))}
      </dl>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-center gap-1 border-t border-line px-4 py-2 text-2xs font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        <Icon
          name="arrow-left"
          className={cn(
            "h-3 w-3 transition-transform",
            expanded ? "rotate-90" : "-rotate-90",
          )}
        />
        {expanded
          ? "Show less"
          : `Show all ${INTAKE_FIELD_KEYS.length} fields`}
      </button>
    </section>
  );
}

function IntakeRow({
  field,
  value,
  provenance,
}: {
  field: keyof IntakeFields;
  value: string | null;
  provenance?: FieldProvenance;
}) {
  const filled = Boolean((value ?? "").trim());
  const tier = FIELD_TIERS[field];

  return (
    <div className="px-4 py-2.5">
      <dt className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
        {INTAKE_FIELD_LABELS[field]}
        {!filled && tier === "block" && (
          <span className="rounded bg-state-failed-fill px-1 py-px text-[0.6rem] font-semibold text-[hsl(0_74%_35%)]">
            required
          </span>
        )}
      </dt>

      <dd
        className={cn(
          "mt-0.5 text-sm",
          filled ? "text-ink" : "italic text-ink-subtle",
        )}
      >
        {/* "Not discussed" and "discussed but incomplete" are different facts,
            so they do not get the same words. */}
        {filled
          ? value
          : provenance?.reason
            ? "Incomplete in the notes"
            : "Not provided"}
      </dd>

      {/* Provenance stays visible after confirmation: knowing a value came
          from the notes rather than someone's memory is worth as much when
          revising as it was when confirming. */}
      {filled && provenance && !provenance.reason && (
        <p className="mt-1 line-clamp-2 text-2xs italic text-ink-subtle">
          &ldquo;{provenance.source}&rdquo;
        </p>
      )}

      {!filled && provenance?.reason && (
        <p className="mt-1 text-2xs text-ink-subtle">
          <span className="italic">&ldquo;{provenance.source}&rdquo;</span> —{" "}
          {provenance.reason}
        </p>
      )}
    </div>
  );
}
