import type { ReactNode } from "react";

/**
 * The shared vocabulary. Every screen builds from these so spacing, weight and
 * colour cannot drift between pages.
 */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-ink-inverse hover:bg-accent-hover shadow-sm hover:shadow",
  secondary:
    "bg-surface text-ink border border-line-strong hover:bg-surface-sunken hover:border-line-strong",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-sunken",
  danger: "bg-state-failed text-ink-inverse hover:brightness-95 shadow-sm",
  success: "bg-state-approved text-ink-inverse hover:brightness-95 shadow-sm",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return cn(
    "inline-flex items-center justify-center rounded font-medium",
    // 120ms is the point where a press feels responsive but not instant-harsh.
    "transition-all duration-[120ms] ease-out",
    "disabled:pointer-events-none disabled:opacity-45",
    "active:scale-[0.98]",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    extra,
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div className={cn(interactive ? "card-interactive" : "card", className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ Labels */

/** Small caps section label. Orients without competing with content. */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-2xs font-semibold uppercase tracking-wider text-ink-subtle",
        className,
      )}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------- Meter */

/**
 * A horizontal progress meter. Used for section completion and regeneration
 * budget — both are "n of m" facts that read faster as a shape than a fraction.
 */
export function Meter({
  value,
  max,
  tone = "neutral",
  className,
}: {
  value: number;
  max: number;
  tone?: "neutral" | "positive" | "warning" | "danger";
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  const tones = {
    neutral: "bg-accent",
    positive: "bg-state-approved",
    warning: "bg-state-review",
    danger: "bg-state-failed",
  };

  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken",
        className,
      )}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          tones[tone],
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Skeleton */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded", className)} />;
}

/* ------------------------------------------------------------- Empty state */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface/50 px-6 py-14 text-center">
      {icon && <div className="mb-3 text-ink-subtle">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------- Note */

/**
 * An inline explanation. Every refusal in this application carries a reason,
 * and this is the shape those reasons take.
 */
export function Note({
  tone = "neutral",
  title,
  children,
  className,
}: {
  tone?: "neutral" | "info" | "warning" | "danger" | "success";
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "border-line bg-surface-sunken text-ink-muted",
    info: "border-state-sent/25 bg-state-sent-fill text-ink",
    warning: "border-state-review/30 bg-state-review-fill text-ink",
    danger: "border-state-failed/25 bg-state-failed-fill text-ink",
    success: "border-state-approved/25 bg-state-approved-fill text-ink",
  };

  return (
    <div
      className={cn(
        "rounded border px-3.5 py-2.5 text-sm",
        tones[tone],
        className,
      )}
    >
      {title && <p className="mb-0.5 font-medium">{title}</p>}
      <div className={title ? "text-ink-muted" : undefined}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------- Icons */

/**
 * Inline SVG rather than an icon package: eight glyphs do not justify a
 * dependency, and these inherit currentColor cleanly.
 */
export function Icon({
  name,
  className = "h-4 w-4",
  label,
}: {
  /**
   * Omit for a decorative icon — it is then hidden from screen readers, which
   * is correct when adjacent text already says what it means. Pass `label`
   * only when the icon carries meaning nothing else conveys.
   */
  label?: string;
  name:
    | "check"
    | "clock"
    | "alert"
    | "send"
    | "sparkle"
    | "file"
    | "plus"
    | "arrow-left"
    | "refresh"
    | "lock";
  className?: string;
}) {
  const paths: Record<string, ReactNode> = {
    check: <path d="M20 6 9 17l-5-5" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    alert: (
      <>
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </>
    ),
    send: <path d="m22 2-7 20-4-9-9-4Zm0 0L11 13" />,
    sparkle: (
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    ),
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    "arrow-left": <path d="M19 12H5m0 0 7 7m-7-7 7-7" />,
    refresh: (
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 3v6h-6" />
      </>
    ),
    lock: (
      <>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
  };

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : "true"}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {paths[name]}
    </svg>
  );
}
