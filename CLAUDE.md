# CLAUDE.md

Standing context for this repository. Read `DESIGN.md` before writing code — it
is the specification and it wins over convenience.

## What this is

An AI proposal application for Koya Talent. A salesperson turns discovery-call
notes into a client-ready proposal, Claude writes it section by section, a
**different person** approves it, and only then does it reach the client.

Built for a course that grades production readiness: error handling and failure
visibility, edge cases, cost awareness, safety on repeated runs, and not leaking
secrets. Working on the happy path is the baseline, not the goal.

## Stack

Next.js (App Router) on Vercel · Supabase Postgres · Anthropic API · Resend.
TypeScript throughout.

## Rules that are not negotiable

1. **Never invent a commercial term.** Client name, company, email, pricing and
   timeline come from the intake form and are inserted literally. Pricing and
   Timeline are rendered from the template, never generated. Generated sections
   are checked afterwards: a paraphrased name warns, a currency- or date-shaped
   token not present in the intake is rejected and retried once. A missing price
   renders `[To be confirmed]`, never a number the model chose.

   Extraction may *propose* intake values from raw notes, but only with the
   source phrase they came from, and only a human confirming them makes them
   real. Unsupported or hedged means null, never a guess.
2. **Unknown is not zero, and unknown is not empty.** A value we do not have is
   shown as explicitly missing, with a reason. A file we could not read is
   distinguishable from a file that contained nothing.
3. **Content is editable only in `draft`.** Enforce it in the API, not just the
   UI. An approved proposal forks to a new version rather than being edited.
4. **The approver cannot be the author, and does not send.** Both enforced
   server-side. Roles are stored on `profiles`.
5. **Failures are visible and explained.** Every failure has a state, a
   plain-language cause, and a row in `activity_log`. A retry button appears
   only when retrying could actually help.
6. **Secrets are server-side only.** Anthropic, Supabase service and Resend keys
   live in Vercel environment variables. `.env*` is gitignored. Secrets in git
   history count as secrets.
7. **`DEMO_MODE=true` redirects all outgoing email** to a configured address,
   and the UI shows the real intended recipient before sending.
8. **Every model call is logged, including discarded ones.** A rejected
   generation spent tokens. `activity_log` carries all attempts;
   `proposal_sections` carries only the one that survived.
9. **Every model call counts against the rate limit.** Extraction,
   summarization, generation, regeneration and rejected attempts alike. A call
   that spends money and is not counted is an unbounded spend path.

## Interface principle

Understandable in five seconds, readable after that. Status, ownership and
what-needs-me come first and visually. Prose supports; it is not the entry
point. Failed sends sort above everything else on the queue.

## Models

- **Sonnet** extracts intake fields from raw call notes. Judgment about what
  the source actually supports; once per proposal.
- **Haiku** summarizes uploaded supporting materials. Mechanical, many files,
  no judgment.
- **Sonnet** writes proposal sections. Client-facing prose, one call per
  section.

Model choice follows the ratio of judgment to volume, per task rather than per
project. Record `model_used`, `input_tokens` and `output_tokens` on every call,
including ones whose output is discarded.

## Conventions

- Server actions or route handlers for anything touching a key. No client-side
  Anthropic calls, ever.
- Every state transition writes to `activity_log`.
- Prefer explicit failure over a plausible default.
- Comments explain _why_, not _what_.
