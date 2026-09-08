# DESIGN.md — AI Proposal Application

Design decisions made before implementation. Claude Code should implement from
this document. Where this conflicts with a convenient shortcut, this wins.

**Stack:** Next.js (App Router) on Vercel · Supabase Postgres · Anthropic API ·
Resend for delivery.

---

## 1. What this is

A salesperson turns discovery-call notes into a client-ready proposal. Claude
writes it section by section. The salesperson revises. A **different person**
approves it. Only then does it reach the client, and every step is logged.

The PRD does not require two people. We are doing it anyway, because approval by
the author is theatre — the control it claims to provide does not exist.

---

## 2. The state machine

This is the architecture. Everything else follows from it.

```
                          ┌──────── first edit ────────┐
                          ▼                            │
   [new] ──► draft ──submit──► in_review ──────► changes_requested
               ▲                   │
               │                   └──approve──► approved ──send──► sent
               │                                     │
               │                                     │
   edit after approval ──► NEW VERSION               │
         (draft, v+1) ─────────┘                     │
                                                     │
                          a failed send leaves status `approved`.
                          Delivery state lives in `deliveries`, not here.
```

Five statuses, and `send_failed` is deliberately not one of them. It remains an
`activity_log` event — the failure is worth recording; it is just not a state
the proposal is in.

### Rules the code must enforce

1. **Content is editable only in `draft`.** Any write to a section outside
   `draft` is rejected by the API, not just hidden in the UI.
2. **An approved proposal is frozen forever.** Editing it does not modify it —
   it creates version N+1 in `draft`, linked to the parent. Version N stays
   exactly as approved, permanently, in the audit trail. What the new version
   inherits is specified in full below under "What a fork carries"; a fork costs
   zero model calls.
3. **The approver cannot be the author.** Enforced server-side. If the author
   opens their own proposal in review, they see it read-only with an
   explanation. Roles live in `profiles`; without stored roles this rule is
   decoration.
4. **The approver cannot edit content.** They approve or request changes with a
   written note. Separation of duties means the reviewer does not become an
   author.
5. **Only `approved` can be sent, and only by the author.** The approver's job
   ends at the decision; letting them also deliver hands one person the whole
   chain and undoes rule 3. Sending is idempotent, enforced by a partial unique
   index rather than by an application-level check — a read-then-insert loses a
   double-click.
6. **`changes_requested` is a resting state, not a transition.** A rejected
   proposal sits there displaying the approver's note, and returns to `draft` on
   the salesperson's first edit. The queue must be able to tell a proposal that
   was never submitted from one that came back.

### Delivery state is not proposal state

A send that fails does not change `status`. The proposal was approved and that
decision still stands. Whether it reached the client is a fact about
`deliveries`: the proposal is in trouble when its most recent attempt failed and
no attempt has succeeded. Deriving it from the delivery rows means there is one
source of truth and no second state to keep in sync — an earlier draft of this
document carried a `send_failed` status and contradicted itself two sections
later.

### Why versioning rather than a hard lock

The instinct — "if it is approved it cannot be edited" — is right, but a hard
lock means a typo forces a full regeneration. Versioning satisfies the same
requirement: the approver's decision always points at an exact document, nobody
can quietly change what was approved, and the salesperson is not blocked.

Because each version is its own row in `proposals`, a `proposal_id` already
names an exact version. Approval and delivery records therefore carry only that
id — a denormalized `version` column alongside it is a second copy of the same
fact and an invitation for the two to disagree.

### What a fork carries

"Creates version N+1" is not a specification until every table has an answer.
A fork is one transaction, and this is the whole of it:

| Table                  | On fork                | Why                                                                                                        |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `proposals`            | New row, `version`+1, `parent_id` = N, `status` `draft` | The point of the exercise.                                                  |
| — intake fields        | Copied verbatim        | A fork is a correction to the prose, not a new discovery call. Editing intake on v2 is allowed; it starts from what v1 had. |
| — `field_gaps`         | Copied                 | The gaps were real at v1 and are still real at v2 until intake changes. Recomputed on the next generation.  |
| — `raw_notes`, `field_provenance` | Copied      | v2 starts from the same call and the same confirmed values. Dropping the provenance would make an inherited field look hand-typed, and re-running extraction would cost a model call to reproduce what a human already confirmed. |
| — `share_token`        | **Inherited**          | The link in the client's inbox must keep working. See section 9.                                            |
| `proposal_sections`    | Deep-copied, content and all | v2 opens as a readable document, not an empty shell. The salesperson fixes a typo; they do not regenerate four sections to get back to where they were. |
| — `section_key`, `title`, `position`, `source` | Copied | The document has the same shape. Template sections stay template sections. |
| — `regenerated_count`  | **Reset to 0**         | The cap is a guard against thrashing one section, not a lifetime budget for a document. A v2 inheriting an exhausted count means a typo fix cannot be regenerated at all. |
| — `edited_by_human`    | Copied                 | It is still true of the text being carried over.                                                            |
| — token counts, `model_used`, `last_generated_at` | Copied | They describe the generation that produced this text, which is the same text. |
| — `generated_from`, `stale_fields` | Copied      | The text is the same and the intake is the same, so its drift status is unchanged. A fork that reset these would hide drift that was real on v1. |
| `supporting_materials` | **Re-linked, not re-summarized** | See below.                                                                                |
| `section_materials`    | Re-pointed to the new section rows | The provenance is unchanged.                                                    |
| `approvals`            | Not copied             | v2 has not been approved. v1's approval stays on v1, which is the entire point of versioning. |
| `deliveries`           | Not copied             | v2 has not been sent.                                                                                       |
| `activity_log`         | New `version_forked` row on the new proposal | The fork is itself an event.                                                  |

**Materials are re-linked, never re-summarized.** A summary of an unchanged file
is an unchanged summary. Re-running Haiku on fork would mean a one-word typo fix
costs ten model calls and produces ten summaries identical to the ones already
stored. Since `supporting_materials.proposal_id` points at a single version, the
fork inserts new rows copying `filename`, `mime_type`, `size_bytes`,
`extraction_status`, `extraction_note`, `extracted_text` and `summary` from the
parent's rows — a row copy, not a model call. Files newly uploaded to v2 are
extracted and summarized normally.

**Inherited and new materials share one cap.** `MAX_MATERIALS_SUMMARIZED` counts
every material on the version, however it arrived: ten inherited files leave
room for none, not for ten more. The cap exists to bound how much a single
proposal can cost, and a limit that resets on each fork bounds nothing — three
forks would carry it to forty. Inherited rows cost no model call, but they do
consume context on every subsequent generation, which is the other thing the cap
is protecting.

A fork therefore costs **zero model calls**. That is the property to protect: if
forking is expensive, people will edit approved documents instead, and rule 2
becomes the thing they route around.

---

## 3. Roles

Two roles, real separation, low friction for whoever is grading.

- **Salesperson** — creates, generates, edits, regenerates sections, submits for
  review, and sends after approval.
- **Approver** — sees the review queue, reads, approves or requests changes with
  a note. Cannot edit, and does not send.

The role is a stored column on `profiles`, not an assumption about which button
someone clicked. Rule 3 is server-enforced by comparing the approver's id to
`author_id`, which requires knowing who is entitled to approve at all.

### Why the author check cannot fire today, and stays anyway

The two roles are disjoint, and only salespeople create proposals. So
`approver_id != author_id` is true by construction and the check never rejects
anything in this deployment. That is worth being precise about, because "this
branch is unreachable" and "this branch is load-bearing" imply opposite things
about whether the next person may delete it.

It is unreachable **under the current seed data**, not in principle. The role
split is disjoint incidentally — we seeded two accounts — and not because
anything in the design requires it to stay that way. A third account with both
capabilities, or a real deployment where a sales lead approves a peer's work,
makes the check the only thing standing between the system and self-approval.
The rule is a property of the system; the disjoint roles are a property of this
week's fixtures.

Because an unreachable branch is untested by definition, it gets a test that
constructs the violating case directly at the API layer — an approve request
where `approver_id == author_id`, bypassing the UI that would never offer it —
and asserts a rejection. Without that, the guard is a comment that resembles a
control. Rule 5's author-only send has the same shape and gets the same
treatment.

Supabase magic-link auth. **Two pre-seeded demo accounts with one-click sign-in
on the landing page**, because the live link has to work for someone who is not
us and has no account. Making a grader sign up would fail the requirement.

---

## 4. Data model

```sql
-- Who may do what. Without this, "the approver cannot be the author" has
-- nothing to check against.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       text not null check (role in ('salesperson','approver')),
  created_at timestamptz default now()
);

-- One row per version. Versions chain through parent_id.
create table proposals (
  id                  uuid primary key default gen_random_uuid(),
  version             int not null default 1,
  parent_id           uuid references proposals(id),
  status              text not null default 'draft'
                        check (status in ('draft','in_review','changes_requested',
                                          'approved','sent')),
  author_id           uuid not null references profiles(id),
  author_name         text not null,

  -- intake. These are inserted into the document literally and are never
  -- rewritten by the model.
  client_name         text,
  client_email        text,
  company_name        text,
  date_of_call        date,
  salesperson_name    text,
  client_needs_summary text,
  project_scope       text,
  goals_and_objectives text,
  recommended_services text,
  proposed_timeline   text,
  estimated_pricing   text,

  -- which fields were missing at generation time and how each was treated
  field_gaps          jsonb not null default '[]'::jsonb,

  -- The raw discovery-call notes, kept verbatim. Extraction reads these; they
  -- are never shown to the client and never sent to section generation, which
  -- sees only the confirmed intake fields above.
  raw_notes           text,

  -- Where each intake value came from, when extraction proposed it:
  --   {"client_name": {"source": "spoke with Dana Whitfield at Northwind",
  --                    "confirmed": true}}
  -- A field absent from this map was typed by hand. `confirmed` flips when the
  -- salesperson accepts the confirm screen — nothing is fixed until then.
  field_provenance    jsonb not null default '{}'::jsonb,

  -- One token per version CHAIN, not per version: a fork inherits its parent's
  -- token so a link already in a client's inbox keeps working. Deliberately not
  -- unique. See section 9, "The client link outlives the version".
  share_token         text not null,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index on proposals (share_token);

-- Sections are separate rows. This is what makes "regenerate one section
-- without losing the rest" possible, and it cannot be retrofitted cheaply.
create table proposal_sections (
  id                uuid primary key default gen_random_uuid(),
  proposal_id       uuid not null references proposals(id) on delete cascade,
  section_key       text not null,     -- introduction, solution, deliverables,
                                       -- timeline, pricing, next_steps
  title             text not null,
  position          int not null,

  -- 'generated' (Sonnet wrote it) or 'template' (rendered from intake).
  -- Timeline and Pricing are always 'template'. This column is what the UI
  -- reads to decide whether a regenerate control exists at all — see section 9.
  source            text not null default 'generated'
                      check (source in ('generated','template')),

  content           text,              -- markdown

  -- Snapshot of the intake fields this section was generated from. Compared
  -- against live intake on every intake write to detect drift — see section 6,
  -- "Intake can change after generation". Null for source='template', which is
  -- re-rendered rather than compared.
  generated_from    jsonb,

  model_used        text,              -- null for source='template'
  input_tokens      int default 0,
  output_tokens     int default 0,
  regenerated_count int default 0,     -- capped at MAX_REGENERATIONS_PER_SECTION;
                                       -- always 0 for source='template'
  edited_by_human   boolean default false,
  last_generated_at timestamptz,       -- null for source='template'

  -- Why this section may no longer match what it was built on. Empty means
  -- current. Entries are tagged: {"kind":"intake","field":"client_name"} or
  -- {"kind":"section","section_key":"solution"}. Set by the intake-write diff
  -- and by regeneration of an earlier section; cleared on regeneration.
  stale_fields      jsonb not null default '[]'::jsonb,

  unique (proposal_id, section_key)
);

-- Uploaded context. Extraction status is first-class: a file we could not read
-- must be visibly different from a file that contained nothing useful.
create table supporting_materials (
  id                uuid primary key default gen_random_uuid(),
  proposal_id       uuid not null references proposals(id) on delete cascade,
  filename          text not null,
  mime_type         text,
  size_bytes        int,
  extraction_status text not null
                      check (extraction_status in ('ok','unsupported','failed','empty')),
  extraction_note   text,              -- why, in words
  extracted_text    text,
  summary           text,              -- Haiku's summary, what generation sees
  created_at        timestamptz default now()
);

-- Which materials informed which section. Section 6 promises a salesperson can
-- see what the model actually used; that promise needs a table.
create table section_materials (
  section_id  uuid not null references proposal_sections(id) on delete cascade,
  material_id uuid not null references supporting_materials(id) on delete cascade,
  primary key (section_id, material_id)
);

-- Every approval decision, kept forever. proposal_id names the exact version.
create table approvals (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references proposals(id),
  approver_id   uuid not null references profiles(id),
  approver_name text not null,
  decision      text not null check (decision in ('approved','changes_requested')),
  note          text,
  created_at    timestamptz default now()
);

-- Delivery attempts, including the ones that failed.
create table deliveries (
  id                  uuid primary key default gen_random_uuid(),
  proposal_id         uuid not null references proposals(id),
  intended_recipient  text not null,   -- the real client address
  actual_recipient    text not null,   -- where it went (demo mode redirects)
  demo_mode           boolean not null default true,
  status              text not null check (status in ('sent','failed')),
  provider_message_id text,
  error               text,             -- raw provider error, for debugging
  failure_reason      text,             -- plain language, shown to the user
  retryable           boolean,          -- false for config problems a retry cannot fix
  attempt             int not null default 1,
  created_at          timestamptz default now()
);

-- Idempotency, enforced by the database. A version can succeed at most once, so
-- a double-clicked send cannot deliver twice however the requests interleave.
-- Failed attempts are unconstrained: retrying is the whole point.
create unique index deliveries_one_success_per_version
  on deliveries (proposal_id) where status = 'sent';

-- Audit trail. Every state change, every generation ATTEMPT, every send.
create table activity_log (
  id           bigserial primary key,
  proposal_id  uuid references proposals(id) on delete cascade,
  actor_name   text,
  event        text not null,          -- created, intake_extracted,
                                       -- intake_confirmed, generated,
                                       -- generation_rejected, generation_failed,
                                       -- regenerated, material_summarized,
                                       -- intake_edited, sections_marked_stale,
                                       -- submitted, approved, changes_requested,
                                       -- version_forked, sent, send_failed,
                                       -- rate_limited
  detail       text,
  -- Attempts that were thrown away still cost money. Recording tokens here and
  -- not only on the section is what makes the real spend visible.
  model_used   text,
  input_tokens  int default 0,
  output_tokens int default 0,
  created_at   timestamptz default now()
);
```

**Every model call writes a row here, including the ones whose output was
discarded.** A section rejected by the commercial-terms check and retried has
spent tokens twice and produced one section; a log that only records the
successful attempt understates the cost of the run and hides the fact that the
model needed a second try. `proposal_sections` carries the tokens of the attempt
that survived — `activity_log` carries all of them.

RLS on every table. The public client view reads through a `share_token`, not
through the tables directly.

### The client-view function

The public page is unauthenticated, so it cannot satisfy any RLS policy written
for signed-in users. It reads through a single **`security definer`** function
that takes the token and nothing else:

```sql
create function public.get_shared_proposal(token text)
returns jsonb
language sql
security definer
set search_path = public
as $$ ... $$;
```

`security definer` is required — without it the call runs as the anonymous role
and RLS refuses every row. That makes the function's scoping the only thing
standing between a token and the whole database, so it is written narrowly and
deliberately:

- It resolves the token to the **most recent version in that chain with a
  successful delivery**, and returns nothing if there is none. A token alone
  never exposes a draft, an unsent fork, or a version still in review.
- It returns **only** the six section rows (content, title, position) and the
  intake fields that appear in the document. Not `author_id`, not
  `field_gaps`, not `activity_log`, not the delivery rows, not the internal ids.
- It returns `null` for an unknown token, with the same response shape and
  timing as a token whose chain has no sent version — an error that distinguishes
  the two is an oracle for guessing tokens.

Tokens are generated with a CSPRNG at 128 bits or more. A guessable share token
is a public proposal.

---

## 5. Intake, and where it comes from

### The form was asking the salesperson to write the proposal

An earlier version of this design put the salesperson straight into a form with
eleven fields, four of which — summary of needs, project scope, goals and
objectives, recommended services — are the substance of the document. Filling
those in *is* writing the proposal. Everything downstream was then reformatting
prose a human had already composed.

That inverts the problem the PRD describes. The complaint is that writing takes
too long and quality depends on who writes it. A form that demands the writing
up front solves neither.

So intake has two stages: notes in, structured fields out, human confirms.

```
   Screen 1: NOTES                Screen 2: CONFIRM
   ┌────────────────────┐         ┌────────────────────┐
   │ raw call notes     │  ────►  │ intake form,       │  ────►  draft
   │ + supporting files │ extract │ pre-filled, each   │ confirm proposal
   └────────────────────┘         │ value showing its  │
                                  │ source phrase      │
        (skippable)               └────────────────────┘
```

**Screen 1 — Notes.** A large textarea for raw discovery-call notes, plus file
upload for supporting materials. Either is sufficient; both is better. This
screen is **skippable** — a salesperson arriving with a clean brief should not
be walked through a stage they do not need, and manual entry remains a
first-class path rather than a fallback.

**Extraction.** One model call reads the notes and the material summaries and
proposes a value for every intake field.

**Screen 2 — Confirm.** The existing intake form, pre-filled. Every populated
field shows the phrase in the source it came from, directly beneath it. Fields
the source did not support are empty and flagged with their tier exactly as
they are today.

### Extraction never invents

The same rule as everywhere else in this system, and here it is load-bearing in
a new way: extraction feeds the fields that generation then treats as fixed.

- A field the source does not support comes back **null**, not guessed. "Not
  mentioned" is an answer.
- Every proposed value carries the **source phrase** it came from — a span of
  the actual notes or summary, quoted, not paraphrased. A value whose source
  cannot be quoted is not a value; it is an inference, and it is dropped.
- Hedged language does not become a commercial term. "Maybe around forty grand,
  depends on scope" supports no `estimated_pricing`. Half-committing on the
  salesperson's behalf is exactly the failure the whole document is written
  against.

**Nothing is fixed until confirmed.** The commercial-terms guarantee therefore
strengthens rather than weakens: *every commercial term in the finished
document was confirmed by a human who saw where it came from.* Before, the
guarantee was that the model never altered what the salesperson typed. Now it
also covers how those values got into the form.

The source phrase is what makes the confirm screen real work rather than a
rubber stamp. A pre-filled form with no provenance invites scrolling to the
bottom and clicking through; a pre-filled form that says *"£48,000 — from: 'we
landed on forty-eight thousand for the whole build'"* is something a human can
actually check in seconds.

### A hand-edited value loses its provenance

If the salesperson changes a value extraction proposed, the stored source phrase
no longer supports what is in the field. Leaving it attached would be worse than
having none: the form would show a quotation that appears to justify a number
nobody extracted, which is exactly the false confidence this screen exists to
prevent.

So **any edit to a field drops its provenance entry.** The value becomes
hand-typed, indistinguishable from one entered on the manual path, and the UI
stops showing a source for it. This is checked on write by comparing the
submitted value against the one extraction proposed — not by trusting the client
to say whether it edited something.

### Extraction runs on Sonnet, not Haiku

Model choice follows the ratio of judgment to volume, and this call is almost
entirely judgment.

Deciding whether "roughly forty grand, maybe less if we drop the migration"
supports `estimated_pricing` — or is too hedged to be a commercial term at all
— is the same class of decision as writing a section, not the same class as
summarizing a file. It happens **once per proposal**, not once per uploaded
document, so the volume argument that puts Haiku on summarization does not
apply.

The asymmetry of errors settles it. An over-eager extraction puts an
unconfirmed number in front of someone who is skimming, and the confirm screen
only works if its defaults are trustworthy enough to *check* rather than
rewrite. A cautious extraction leaves a field empty, which the tier system
already handles well. Sonnet is meaningfully better at that caution, and the
cost difference on a few thousand tokens of notes is around a cent.

Haiku stays where the original argument holds: summarizing materials, where
there may be ten files and no judgment is required.

### What extraction is logged as

`intake_extracted`, with `model_used` and both token counts, like every other
model call. It costs money and belongs in the running spend the editor shows.

---

## 6. Generation

### Three model calls, deliberately different

- **Sonnet** extracts intake fields from raw notes. Judgment about what the
  source actually supports, once per proposal. See section 5.
- **Haiku** reads and summarizes supporting materials. Mechanical, potentially
  several files per proposal, no judgment required.
- **Sonnet** writes the proposal sections. Client-facing prose, one call per
  section, and the section is only as good as the judgment behind it.

Same principle as Weeks 1 and 2: model choice follows the ratio of judgment to
volume. This is the first project where both models appear in one system, and
the split is per-task rather than per-project.

### One call per section, not one for the whole document

Because regeneration is per-section. Generating the whole proposal in one call
and splitting it afterwards means a regeneration either re-rolls everything or
requires parsing the model's own formatting to find boundaries. Separate calls
cost slightly more and remove an entire class of bug.

### What each section call receives

Sections are generated in `position` order, and each call gets:

1. The intake fields, marked as fixed values that must not be altered.
2. The summaries of the supporting materials (not the raw extracted text).
3. **The already-generated sections that precede it**, as context.

The third is what keeps the document coherent — without it, Deliverables can
promise something Proposed Solution never mentioned, and the reader is the one
who notices. Sections are generated in order so that each has everything before
it and nothing after it.

The cost consequence is worth stating plainly: **input tokens grow with
position.** Next Steps is the most expensive call in the document, because it
carries the three sections before it. This is a deliberate trade — a
contradiction between sections is a defect a client sees, and re-reading the
preceding sections is cheap next to producing them. Only preceding *content* is
passed, never the whole conversation, so growth is linear and bounded by the
document.

A **regeneration** of one section receives the same context: intake, summaries,
and the current content of the sections before it. Regenerating section 2 does
not re-run sections 3 and 4, so they can end up referring to a solution that has
changed. Cascading would turn one intentional regeneration into four calls and
re-roll text the human may have already edited, so the following sections are
**marked, not regenerated** — see below.

### Four sections are generated. Two are rendered.

The template has six sections, but only four of them require judgment:

| Section              | `section_key` | `source`     | Written by                     |
| -------------------- | ------------- | ------------ | ------------------------------ |
| 1. Introduction      | `introduction`| `generated`  | Sonnet                         |
| 2. Proposed Solution | `solution`    | `generated`  | Sonnet                         |
| 3. Deliverables      | `deliverables`| `generated`  | Sonnet                         |
| 4. Timeline          | `timeline`    | `template`   | Renderer, from `proposed_timeline` |
| 5. Pricing           | `pricing`     | `template`   | Renderer, from `estimated_pricing` |
| 6. Next Steps        | `next_steps`  | `generated`  | Sonnet                         |

Timeline and Pricing are the intake values with surrounding boilerplate. There
is no judgment in them, and they are precisely the two fields where an invented
value does the most damage. Asking a model to render a number we already have is
paying tokens to introduce a risk that we then have to write a checker to catch.

So they are not generated at all. This costs two fewer calls per proposal and
removes the largest fabrication surface in the system rather than policing it.
It also settles what `[To be confirmed]` means: the template emits the marker
wherever the intake value is empty, and no model output has to survive with it
intact.

**All six are rows in `proposal_sections`.** The template sections are not a
special case bolted onto the render path — they are ordinary rows carrying
`position`, so ordering, display, preview and the client view treat all six
identically and nothing has to know that two of them arrived differently.

What distinguishes them is the `source` column, and it has consequences:

- `model_used` and `last_generated_at` are **null**. Not zero, not a placeholder
  model name. Nothing generated them.
- `input_tokens` and `output_tokens` are 0, and that 0 is true rather than
  unknown.
- `regenerated_count` is meaningless and stays 0. `MAX_REGENERATIONS_PER_SECTION`
  does not apply.
- **The regenerate control is absent, not disabled.** A greyed-out button is a
  claim that the action exists and is unavailable right now; there is no such
  action here, and a disabled control invites someone to find the condition that
  enables it. The card shows where the value came from — _"From intake:
  Estimated Pricing"_ — with a link to edit the intake field instead.
- Re-rendering a template section happens automatically when its intake field
  changes. It is not a user-facing operation and costs nothing.

Anyone wiring a regenerate button to a `source='template'` row has misread this
section.

### The model never writes a commercial term

Client name, company, email, pricing and timeline are **inserted literally from
intake**. The prompt is told they are fixed values, and after generation every
section is checked. The check has two halves, because the two risks are not
alike.

Extraction (section 5) does not weaken this. A value it proposes is a *draft
answer* until the salesperson confirms it on a screen that shows where it came
from, and only confirmed values reach generation. The guarantee is therefore
stronger than "the model did not alter what was typed" — it is that **every
commercial term in the finished document was confirmed by a human who saw its
source**.

**Names — normalized containment, warn on mismatch.** Client name, company and
email are compared case- and whitespace-insensitively. A model that writes
"Acme" for "Acme Corp Ltd" has paraphrased, not fabricated, so a mismatch raises
a warning on the section for a human to look at. Rejecting on exact string
equality would fire constantly and teach people to ignore it.

**Numbers and dates — hard rule, reject.** Any currency-shaped or date-shaped
token appearing in a generated section that is not present in the intake is a
fabrication. There is no benign reason for a price or a date to appear in prose
that did not come from the salesperson. The section is rejected, retried once,
and if the retry also fails the section fails cleanly — **leaving the previous
content in place.** A failed regeneration never blanks a section that was fine.

Both the rejected attempt and the retry are written to `activity_log` with their
token counts.

### Intake can change after generation

The commercial-terms check runs at generation time. Intake can be edited after
that, and then it has already run — against values that no longer exist.

A salesperson generates four sections, then corrects `client_name` from "Acme"
to "Acme Corp Ltd". The template sections re-render. The generated sections do
not: the introduction still says "Acme", the check that would have caught it
passed hours ago against the old value, and nothing anywhere says the document
no longer matches its inputs. This is the failure the whole commercial-terms
apparatus exists to prevent, arriving through the back door — the same shape as
editing an approved proposal, one layer down.

**Every generated section stores `generated_from`: a snapshot of the intake
fields it was written from.** On any intake write, each generated section's
snapshot is diffed against the new values, and the fields that changed are
recorded in `stale_fields`.

The comparison is a **diff against the snapshot, not a re-run of the
commercial-terms check.** Re-running the check asks "is this section consistent
with intake?", and for names that question has no clean answer — a section that
says "Acme" when intake says "Acme Corp Ltd" may have drifted or may simply be
paraphrasing, which is exactly why that half of the check warns rather than
rejects. The snapshot asks a question with a definite answer: *were the inputs
different when this text was written?* It also names the specific field that
changed, which is what makes the prompt worth showing.

The snapshot catches a case a re-check cannot. If `project_scope` is rewritten
wholesale, no commercial term has been altered and a scan finds nothing wrong —
but the section is now built on a superseded brief. Drift is a fact about the
inputs, so it is detected by looking at the inputs.

**A stale section is never silently regenerated and never blocks anything.** It
carries a visible marker naming what changed — _"Intake changed since this was
written: Client Name"_ — and a regenerate button. Regeneration clears
`stale_fields` and writes a fresh snapshot. Staleness costs nothing to detect
and no model call to report; only the fix costs anything, and the salesperson
decides whether to spend it.

### A regenerated section makes the ones after it stale

Sections are generated in order, each reading the ones before it, so
regenerating section 2 leaves 3, 4 and 6 written against a solution that no
longer exists. Nothing in the intake changed, which makes this drift *less*
visible than the intake kind — there is no edited field to notice.

So it uses the same mechanism. Regenerating a section appends
`{"kind":"section","section_key":"solution"}` to `stale_fields` on every
`generated` section that follows it by `position`. The marker reads _"Proposed
Solution was regenerated after this was written"_ and carries the same
regenerate button.

**This persists rather than prompting.** A toast at regeneration time is
dismissed or missed, and then nothing records that section 4 may contradict
section 2 — which is the silent-drift failure this whole area exists to prevent,
reintroduced one layer along. A flag survives a page reload, a session, and a
handoff to whoever picks the proposal up next.

It reuses `stale_fields` rather than adding a column because it is the same
statement about the same section: *this text may no longer match what it was
built on.* The tagged entries say which cause, the UI treats them identically,
and one column means one clearing rule instead of two that can disagree.

Template sections are skipped — they hold no prose that can contradict anything.

Submitting for review with stale sections is **allowed but warned**, on the same
reasoning as the Warn tier in section 8: the salesperson may have judged the
change immaterial, and that is a call a human is entitled to make. The approver
sees the same markers, so the decision is visible to the person the separation of
duties exists to protect.

Template sections are exempt — they re-render from intake automatically, so they
cannot be stale. Their `generated_from` is null.

### Cost ceilings

Generation is the only expensive thing this application does, and every path to
spending money is bounded:

| Limit                              | Value | Why                                                       |
| ---------------------------------- | ----- | --------------------------------------------------------- |
| `MAX_REGENERATIONS_PER_SECTION`    | 5     | Past five attempts the prompt is wrong, not the sample.    |
| `MAX_MATERIALS_SUMMARIZED`         | 10    | Twenty files is twenty Haiku calls before a single section exists. Files beyond the cap are stored and shown, not summarized, with the reason visible. |
| `GENERATIONS_PER_HOUR_GLOBAL`      | 60    | See section 11. A public one-click demo is a public spend button. |

The editor shows running token cost for the proposal — summed from
`activity_log`, so discarded attempts are included in what the salesperson sees.

---

## 7. Supporting materials

| Format         | Handling                                       |
| -------------- | ---------------------------------------------- |
| PDF            | Sent to Claude as a document block             |
| PNG, JPG, WEBP | Sent as an image block                         |
| DOCX           | Parsed server-side with mammoth                |
| XLSX, CSV      | Parsed to a markdown table                     |
| TXT, MD        | Straight through                               |
| Anything else  | `unsupported`, with the reason shown in the UI |

Rules:

- **Every uploaded file is processed.** A proposal takes many attachments, and
  each one is extracted and accounted for — taking the first and ignoring the
  rest is the failure mode this table exists to prevent.
- A file that cannot be read is recorded with `extraction_status` and a written
  reason. It never silently disappears.
- A file that parses to almost nothing is `empty`, not `ok` — the Week 2 lesson
  about a successful fetch returning nothing usable.
- Each generated section records which materials informed it in
  `section_materials`, so a salesperson can see what the model actually used.
- Cap total extracted text; a 200-page PDF should be truncated with a visible
  note rather than sent whole.
- At most `MAX_MATERIALS_SUMMARIZED` files are sent to Haiku. Beyond that they
  are stored and listed with an explicit note that they were not summarized —
  an uncounted file is a silent cost, and a silently ignored file is worse.

### Upload path

Files go **directly from the browser to Supabase Storage via a signed URL**, not
through a route handler. Vercel caps a serverless request body at 4.5MB, which a
single PDF clears easily; routing uploads through the server would fail on real
files. The server issues the signed URL, and extraction runs afterwards against
the stored object.

Extraction runs on the **Node runtime**, not Edge — mammoth and the spreadsheet
parser need Node APIs.

A row is written to `supporting_materials` *before* extraction is attempted, so
a crash mid-extraction leaves a `failed` row with a reason rather than no trace
of the file at all. Files are processed one at a time, each in its own
try/catch: one unreadable file never aborts the batch.

---

## 8. Missing information policy

| Tier      | Fields                                                                       | Behaviour                                                                                                                            |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Block** | client_name, company_name, client_email, client_needs_summary, project_scope | Generation is disabled. There is no proposal without these.                                                                          |
| **Warn**  | estimated_pricing, proposed_timeline, recommended_services                   | Generation allowed after an explicit confirmation. The document carries `[To be confirmed]` and the gap is recorded in `field_gaps`. |
| **Mark**  | date_of_call, salesperson_name, goals_and_objectives                         | Generates normally; the gap is noted in the UI and logged.                                                                           |

The distinction that matters: **a missing value is never filled by the model.**
Blocking, warning and marking are three ways of not inventing.

For the two Warn fields that reach the client document — `estimated_pricing` and
`proposed_timeline` — this is now structural rather than a rule the model is
asked to follow. Those sections are rendered from the template (section 6), so
`[To be confirmed]` is what the renderer emits when the intake value is empty.
No model output has to preserve the marker, because no model produces those
sections.

---

## 9. Interface

Week 2 feedback: _the dashboard was too text-based, a founder had to read a lot
before understanding what was going on._ That applies with more force here,
because this is the product rather than a report.

**The rule for every screen: understandable in five seconds, readable after
that.** Status, ownership and what-needs-me come first, visually. Prose is
support, not the entry point.

### Screens

**Landing** — two demo sign-in buttons, one line each explaining the role.

**Queue (home)** — the first thing on screen is not a table. It is a single line
stating what needs this person: _"2 proposals waiting for your approval."_ Below
it, proposal cards with a large status pill, client name, who it is with, and
how long it has been sitting. Colour carries state. A stale proposal in review
looks different from a fresh one.

**Notes** — one large textarea for raw call notes and a drop zone for
supporting files. Either alone is enough to proceed. A visible "skip and fill
the form myself" path, because a salesperson with a clean brief should not be
walked through a stage they do not need.

**Confirm** — the intake form, pre-filled from extraction. Each populated field
carries the source phrase beneath it in quiet type, so the eye lands on the
value and the evidence together. Fields extraction could not support are empty
and carry their tier badge exactly as a manually-filled form does. The primary
action says **Confirm** rather than Save: the salesperson is agreeing that
these values are right, and that agreement is what the commercial-terms
guarantee rests on.

**Intake** — the same form reached directly, with the three tiers visible as
you fill it. Blocked fields are marked before you try to submit, not after.

**Editor** — sections as cards down the page. A `generated` card has its own
regenerate control and shows when it was last generated, whether a human edited
it, and how many regenerations remain. A `template` card has **no regenerate
control at all** and instead names the intake field it came from, with a link to
edit that field — see section 6. A card with a non-empty `stale_fields` carries a
marker naming what changed since it was written. The proposal preview renders
live. Submit for review sits at the bottom and is disabled with a stated reason
if anything blocking is missing, and warns — without blocking — if any section is
stale.

**Review** — read-only, with the intake shown alongside so the approver can
check the proposal against what was actually agreed. Stale sections carry the
same marker they do in the editor: the approver is the person separation of
duties exists to protect, and hiding from them that a section predates its own
inputs would defeat the point. Approve, or request changes with a required note.
If the viewer is the author, the controls are replaced by an explanation. The
approver never sees a send control; delivery belongs to the salesperson.

**Client view** — public, tokenized URL. Clean typeset proposal, no application
chrome. This is what the email links to.

### The client link outlives the version

A client receives the link for v1. Later v2 is approved and sent. The naive
implementation mints a new token per version and leaves the old URL live,
serving a superseded document forever to whoever saved it.

**The token resolves to the most recent *sent* version in its chain, and the
page says so.** One token is minted on the root proposal and inherited by every
fork, so a link already sitting in a client's inbox keeps working and always
shows the current proposal. When the version being served is not the first, the
page carries a dated line — _"Updated 8 September 2026. This replaces the
version sent on 2 September."_ — because a document that changes under a reader
with no acknowledgement is its own kind of dishonesty.

Redirecting silently would hide the change; a stale-banner-only approach would
leave the client reading the wrong document and hunting for a link they may not
have. Doing both is the only option that leaves the client correctly informed
without asking anything of them.

Versions that were never sent are **invisible** to the token. A fork sitting in
`draft` is internal work in progress, and a client link must never expose it.
This is enforced in the `get_shared_proposal` function specified in section 4,
not in the page — the page renders whatever it is given.

### Two different kinds of stale

The word covers two unrelated conditions and the UI must not blur them:

- **A stale *section*** predates its own intake — someone edited a field after
  the section was written. A property of one section, shown on its card in the
  editor and review screens. See section 6.
- **A stale *proposal*** has been sitting in review too long. A property of the
  whole proposal, shown on the queue.

They share no mechanism and never appear in the same place. Different words in
the interface: a section says _"intake changed since this was written"_, a
proposal says _"waiting 3 days"_.

`STALE_IN_REVIEW_HOURS = 48`, a named configurable constant. A proposal in
review past it is surfaced on the queue rather than waiting to be noticed. "Too
long" needs a number or it is not a rule.

### What must never appear

A number the system does not have. Missing values render as an explicit
`[To be confirmed]` marker, styled so it is obvious in a client-facing document.

---

## 10. Failure handling

Every failure gets a state, a written reason and a place in `activity_log`.

- **Generation fails** — the section keeps its previous content and shows the
  error. A failed regeneration must never blank a section that was fine.
- **A section fabricates a number or date** — rejected, retried once, then
  failed cleanly with the previous content intact. Both attempts are logged with
  their token counts; a rejection that costs money and leaves no trace is how
  spend goes unexplained.
- **Intake changes after generation** — affected sections are marked stale and
  say which field changed. Not an error and not blocking: the document is
  internally fine, it just predates its inputs, and the salesperson decides
  whether that matters. Logged as `sections_marked_stale`.
- **A file cannot be parsed** — recorded, shown, generation continues without it.
- **Send fails** — see the dedicated section below. This is the most serious
  state in the system and gets its own treatment.
- **A proposal sits in review past `STALE_IN_REVIEW_HOURS`** — surfaced on the
  queue rather than waiting to be noticed.
- **The hourly generation limit trips** — the user is told what the limit is and
  when it resets, not handed a generic error.
- **Model returns malformed content** — retried once, then failed cleanly.

### Failed sends get their own treatment

An approved proposal that never reached the client is the worst state this
system can be in. Everyone believes the work is done and the client has nothing.
So this failure is never quiet.

**On the queue, failed sends sort above everything else**, in their own band at
the top, regardless of age. A salesperson opening the app sees it before they
see anything they were planning to do.

**Every failure shows a cause in plain language, not a status code.** The raw
provider error is stored for debugging, but what a salesperson reads is what
went wrong and what to do about it:

| What happened                        | What the user sees                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Recipient rejected / invalid address | The client's email address was rejected. Check it on the intake form and correct it, then retry.      |
| Sending domain not verified          | The sending domain is not verified with the email provider. This needs an administrator, not a retry. |
| Rate limited                         | The email provider is throttling us. Wait a minute and retry.                                         |
| Auth failure / missing key           | Email is not configured on the server. This needs an administrator.                                   |
| Provider unreachable / 5xx           | The email service could not be reached. This is usually temporary — retry.                            |
| Anything else                        | The send failed with an unexpected error. The details are below; contact whoever maintains this.      |

Each row carries a flag for whether retrying is worth it. **A retry button only
appears when retrying could actually help** — a domain that is not verified will
fail identically a hundred times, and offering the button teaches people to
distrust it.

**Retry rules.** A partial unique index on `deliveries (proposal_id) where
status = 'sent'` makes a second successful delivery of one version impossible at
the database level, so a client can never receive the same proposal twice no
matter how the requests race. A failed delivery leaves the proposal `approved`
with a visible failure banner — it never silently reverts to draft, because it
_was_ approved and that decision still stands, and there is no `send_failed`
status to revert to. The banner is derived: latest attempt failed, none
succeeded.

Retrying is the salesperson's action, like the original send.

Every attempt, successful or not, is a row in `deliveries`. Three failed
attempts followed by a success is a story someone can read later.

---

## 11. Security

- The Anthropic key, the Supabase service key and the Resend key are server-side
  only, in Vercel environment variables. Never in client code.
- `.gitignore` covers `.env*` from the first commit. Secrets in git history count
  as secrets.
- RLS on every table. The client view reads through a share token.
- **`DEMO_MODE=true` redirects every outgoing email to a configured address**,
  while the UI shows the real intended recipient before sending. A demo
  application must not be able to email a stranger.

### Rate limiting is a security control, not an optimization

One-click demo sign-in on a public URL means anyone who finds the link can spend
our Anthropic budget. This is built in **Phase 0**, before there is anything
worth attacking — a limit added later is a limit that was absent during the
window the link was being shared around.

`GENERATIONS_PER_HOUR_GLOBAL = 60`, counted **across all sessions**, not
per-user: with shared demo accounts a per-user limit is trivially sidestepped by
signing in as the other one.

### What counts against the limit

Every event in `activity_log` that represents a model call, without exception:

| Event                 | Model  | When                                        |
| --------------------- | ------ | ------------------------------------------- |
| `intake_extracted`    | Sonnet | Once per proposal, on the notes screen      |
| `material_summarized` | Haiku  | Once per uploaded file, up to the cap       |
| `generated`           | Sonnet | Once per written section                    |
| `regenerated`         | Sonnet | Each regeneration of a section              |
| `generation_rejected` | Sonnet | A fabrication caught and retried            |

The rejected attempts are in the list deliberately: a call whose output was
thrown away spent exactly as much as one that survived, and a limiter that
ignores it can be defeated by an input that reliably produces rejections.

Naming these explicitly is not documentation for its own sake. Extraction is a
model call reachable from a public one-click demo, and an event missing from
this list is an unbounded spend path sitting beside the one this section exists
to bound. Any new model call must be added here and to `BILLABLE_EVENTS` in
`lib/rate-limit.ts` in the same change.

**The limit is reachable by ordinary use, so the message has to be useful.** One
proposal is one extraction, up to ten Haiku summaries, and four Sonnet sections
— **fifteen calls**, before any regeneration or rejected attempt. Sixty an hour
is roughly four full proposals, and someone exploring the application properly
can reach that without doing anything unreasonable. A grader hitting a generic
error at that point would reasonably conclude the application is broken.

So the message says three things: that the application has hit its hourly
generation limit, the **specific time it resets**, and that everything already
generated is unaffected and still viewable. Nothing is lost and nothing needs
retrying from scratch — only new generation is paused. The event is logged as
`rate_limited`.

---

## 12. Out of scope

Multi-tenant organizations, real e-signature, PDF export (the client view is a
hosted page), and proposal analytics. Named here so the omissions are decisions
rather than gaps.
