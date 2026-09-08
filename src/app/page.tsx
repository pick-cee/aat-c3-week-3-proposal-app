import { redirect } from "next/navigation";

import { signInAsDemo } from "@/app/actions/auth";
import { Icon } from "@/components/ui/primitives";
import { getCurrentProfile } from "@/lib/auth";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";

/**
 * Landing. Two demo sign-in buttons, one line each explaining the role.
 *
 * No sign-up, no magic link, no password field: whoever opens this link has to
 * be using the application within seconds. Every step between them and the
 * product is a step where someone gives up.
 */
export default async function Home() {
  if (await getCurrentProfile()) redirect("/queue");

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* A single soft wash, not a gradient hero. Enough to feel considered,
          not so much that it competes with the two buttons that matter. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[30rem] bg-[radial-gradient(60%_60%_at_50%_0%,hsl(199_89%_48%/0.07),transparent)]"
      />

      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
        <div className="animate-rise">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-ink-inverse">
              <svg
                viewBox="0 0 24 24"
                className="h-[18px] w-[18px]"
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
            <span className="text-sm font-medium text-ink-muted">
              Koya Talent
            </span>
          </div>

          <h1 className="mt-8 text-5xl font-semibold tracking-tight text-ink">
            Proposals, written
            <br />
            and properly approved.
          </h1>

          <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-muted">
            Discovery-call notes in, a client-ready proposal out — written
            section by section, approved by{" "}
            <span className="font-medium text-ink">someone other than its author</span>
            , and logged at every step.
          </p>
        </div>

        <div
          className="mt-12 animate-rise"
          style={{ animationDelay: "80ms" }}
        >
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
            Sign in to try it
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {DEMO_ACCOUNTS.map((account) => (
              <form key={account.role} action={signInAsDemo}>
                <input type="hidden" name="role" value={account.role} />
                <button
                  type="submit"
                  className="card-interactive group w-full p-4 text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={
                        account.role === "approver"
                          ? "flex h-8 w-8 items-center justify-center rounded-full bg-state-review-fill text-xs font-semibold text-[hsl(32_81%_29%)]"
                          : "flex h-8 w-8 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-ink-muted"
                      }
                    >
                      {account.fullName
                        .split(" ")
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {account.fullName}
                      </p>
                      <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                        {account.role}
                      </p>
                    </div>
                    <Icon
                      name="arrow-left"
                      className="ml-auto h-3.5 w-3.5 shrink-0 rotate-180 text-ink-subtle transition-transform group-hover:translate-x-0.5"
                    />
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                    {account.blurb}
                  </p>
                </button>
              </form>
            ))}
          </div>

          <p className="mt-3 text-xs text-ink-subtle">
            Open one in a second browser to walk a proposal through review — the
            same person cannot approve their own work.
          </p>
        </div>

        <div
          className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 animate-rise"
          style={{ animationDelay: "160ms" }}
        >
          <Assurance>Claude never invents a price or a date</Assurance>
          <Assurance>Approval is separated from authorship</Assurance>
          <Assurance>Demo mode never emails a real client</Assurance>
        </div>
      </div>
    </main>
  );
}

function Assurance({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
      <Icon name="check" className="h-3.5 w-3.5 text-state-approved" />
      {children}
    </p>
  );
}
