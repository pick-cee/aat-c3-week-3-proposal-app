import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/app/actions/auth";
import { Icon, buttonClass, cn } from "@/components/ui/primitives";
import type { Profile } from "@/lib/db/types";

/**
 * The frame every signed-in screen sits in.
 *
 * One header, one place navigation lives. Before this, each page drew its own
 * back link and sign-out, which meant three slightly different headers and no
 * sense of being inside one application.
 */
export function AppShell({
  actor,
  children,
  backTo,
  backLabel = "Queue",
}: {
  actor: Profile;
  children: ReactNode;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-6">
          {backTo ? (
            <Link
              href={backTo}
              className="group inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              <Icon
                name="arrow-left"
                className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
              />
              {backLabel}
            </Link>
          ) : (
            <Link href="/queue" className="flex items-center gap-2.5">
              <Logo />
              <span className="text-sm font-semibold tracking-tight">
                Proposals
              </span>
            </Link>
          )}

          <div className="ml-auto flex items-center gap-3">
            <UserBadge actor={actor} />
            <form action={signOut}>
              <button
                type="submit"
                className={buttonClass("ghost", "sm")}
                aria-label="Sign out"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

function Logo() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-ink-inverse">
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 4h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
        <path d="M14 4v6h6" />
      </svg>
    </span>
  );
}

/**
 * Role is shown, not implied. Two people use this application and they can do
 * different things — knowing which one you are signed in as is load-bearing,
 * especially when a grader is switching between them.
 */
function UserBadge({ actor }: { actor: Profile }) {
  const initials = actor.full_name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  const isApprover = actor.role === "approver";

  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden text-right sm:block">
        <p className="text-xs font-medium leading-tight">{actor.full_name}</p>
        <p
          className={cn(
            "text-2xs font-medium uppercase tracking-wide",
            isApprover ? "text-state-review" : "text-ink-subtle",
          )}
        >
          {actor.role}
        </p>
      </div>
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
          isApprover
            ? "bg-state-review-fill text-[hsl(32_81%_29%)]"
            : "bg-surface-sunken text-ink-muted",
        )}
      >
        {initials}
      </span>
    </div>
  );
}

/** Page title block, so every screen introduces itself the same way. */
export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 text-ink-muted">{subtitle}</p>}
        {meta && <div className="mt-3">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
