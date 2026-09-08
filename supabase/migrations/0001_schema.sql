-- Schema for the AI proposal application.
-- Implements DESIGN.md section 4. Column comments record the reasoning that
-- would otherwise be lost the first time someone "tidies up" a nullable column
-- or a deliberately non-unique index.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Who may do what. Without this, "the approver cannot be the author" has
-- nothing to check against.

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       text not null check (role in ('salesperson','approver')),
  created_at timestamptz default now()
);

comment on table profiles is
  'Roles are stored, not inferred from which button someone clicked.';

-- ---------------------------------------------------------------------------
-- proposals
-- ---------------------------------------------------------------------------
-- One row per VERSION. Versions chain through parent_id, so a proposal_id
-- always names an exact version — which is why approvals and deliveries carry
-- no separate version column.

create table proposals (
  id                   uuid primary key default gen_random_uuid(),
  version              int not null default 1,
  parent_id            uuid references proposals(id),

  -- No 'send_failed'. A failed send leaves the proposal `approved`; whether it
  -- reached the client is a fact about `deliveries`. See DESIGN.md section 2,
  -- "Delivery state is not proposal state".
  status               text not null default 'draft'
                         check (status in ('draft','in_review','changes_requested',
                                           'approved','sent')),

  author_id            uuid not null references profiles(id),
  author_name          text not null,

  -- Intake. Inserted into the document literally and never rewritten by the
  -- model. Nullable because the missing-information policy (section 7) treats
  -- absence as a first-class state — a missing value is never filled in.
  client_name          text,
  client_email         text,
  company_name         text,
  date_of_call         date,
  salesperson_name     text,
  client_needs_summary text,
  project_scope        text,
  goals_and_objectives text,
  recommended_services text,
  proposed_timeline    text,
  estimated_pricing    text,

  -- Which fields were missing at generation time and how each was treated.
  -- Entries: {"field": "...", "tier": "block|warn|mark", "treatment": "..."}
  field_gaps           jsonb not null default '[]'::jsonb,

  -- One token per version CHAIN, not per version: a fork inherits its parent's
  -- token so a link already in a client's inbox keeps working. DELIBERATELY
  -- NOT UNIQUE — see section 8, "The client link outlives the version".
  share_token          text not null,

  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create index proposals_share_token_idx on proposals (share_token);
create index proposals_author_idx      on proposals (author_id);
create index proposals_status_idx      on proposals (status);
create index proposals_parent_idx      on proposals (parent_id);

comment on column proposals.share_token is
  'Shared across a version chain. Not unique by design: a fork inherits it.';

-- ---------------------------------------------------------------------------
-- proposal_sections
-- ---------------------------------------------------------------------------
-- Separate rows are what make "regenerate one section without losing the rest"
-- possible, and it cannot be retrofitted cheaply.

create table proposal_sections (
  id                uuid primary key default gen_random_uuid(),
  proposal_id       uuid not null references proposals(id) on delete cascade,
  section_key       text not null
                      check (section_key in ('introduction','solution','deliverables',
                                             'timeline','pricing','next_steps')),
  title             text not null,
  position          int not null,

  -- 'generated' (Sonnet wrote it) or 'template' (rendered from intake).
  -- Timeline and Pricing are always 'template'. The UI reads this to decide
  -- whether a regenerate control EXISTS — not whether it is enabled.
  source            text not null default 'generated'
                      check (source in ('generated','template')),

  content           text,

  -- Snapshot of the intake fields this section was generated from, diffed
  -- against live intake on every intake write to detect drift.
  -- Null for source='template', which is re-rendered rather than compared.
  generated_from    jsonb,

  model_used        text,          -- null for source='template'
  input_tokens      int not null default 0,
  output_tokens     int not null default 0,
  regenerated_count int not null default 0,
  edited_by_human   boolean not null default false,
  last_generated_at timestamptz,   -- null for source='template'

  -- Why this section may no longer match what it was built on. Empty means
  -- current. Entries are tagged:
  --   {"kind":"intake","field":"client_name"}
  --   {"kind":"section","section_key":"solution"}
  stale_fields      jsonb not null default '[]'::jsonb,

  unique (proposal_id, section_key),

  -- A template section has no generation to describe. Enforcing this in the
  -- database keeps "0 tokens" meaning "genuinely zero" rather than "unknown",
  -- which is the distinction section 5 rests on.
  constraint template_sections_have_no_generation check (
    source = 'generated' or (
      model_used is null
      and last_generated_at is null
      and generated_from is null
      and input_tokens = 0
      and output_tokens = 0
      and regenerated_count = 0
    )
  )
);

create index proposal_sections_proposal_idx on proposal_sections (proposal_id, position);

-- ---------------------------------------------------------------------------
-- supporting_materials
-- ---------------------------------------------------------------------------
-- Extraction status is first-class: a file we could not read must be visibly
-- different from a file that contained nothing useful.

create table supporting_materials (
  id                uuid primary key default gen_random_uuid(),
  proposal_id       uuid not null references proposals(id) on delete cascade,
  filename          text not null,
  storage_path      text,               -- object in Supabase Storage
  mime_type         text,
  size_bytes        int,
  extraction_status text not null
                      check (extraction_status in ('pending','ok','unsupported','failed','empty')),
  extraction_note   text,               -- why, in words
  extracted_text    text,
  summary           text,               -- Haiku's summary; what generation sees

  -- False when the file was stored but never sent to Haiku because the
  -- proposal was already at MAX_MATERIALS_SUMMARIZED. A silently ignored file
  -- is worse than an uncounted one, so this is recorded rather than implied.
  summarized        boolean not null default false,

  created_at        timestamptz default now()
);

create index supporting_materials_proposal_idx on supporting_materials (proposal_id);

comment on column supporting_materials.extraction_status is
  '''pending'' exists because the row is written BEFORE extraction is attempted: a crash mid-extraction must leave a trace, not nothing.';

-- ---------------------------------------------------------------------------
-- section_materials
-- ---------------------------------------------------------------------------
-- Section 6 promises a salesperson can see what the model actually used.

create table section_materials (
  section_id  uuid not null references proposal_sections(id) on delete cascade,
  material_id uuid not null references supporting_materials(id) on delete cascade,
  primary key (section_id, material_id)
);

-- ---------------------------------------------------------------------------
-- approvals
-- ---------------------------------------------------------------------------
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

create index approvals_proposal_idx on approvals (proposal_id);

-- ---------------------------------------------------------------------------
-- deliveries
-- ---------------------------------------------------------------------------
-- Delivery attempts, including the ones that failed. Three failed attempts
-- followed by a success is a story someone can read later.

create table deliveries (
  id                  uuid primary key default gen_random_uuid(),
  proposal_id         uuid not null references proposals(id),
  intended_recipient  text not null,    -- the real client address
  actual_recipient    text not null,    -- where it went (demo mode redirects)
  demo_mode           boolean not null default true,
  status              text not null check (status in ('sent','failed')),
  provider_message_id text,
  error               text,             -- raw provider error, for debugging
  failure_reason      text,             -- plain language, shown to the user
  retryable           boolean,          -- false for config problems a retry cannot fix
  attempt             int not null default 1,
  created_at          timestamptz default now()
);

create index deliveries_proposal_idx on deliveries (proposal_id, created_at desc);

-- Idempotency, enforced by the database rather than by a read-then-insert that
-- a double-click can race. A version can succeed at most once; failed attempts
-- are unconstrained, because retrying is the whole point.
create unique index deliveries_one_success_per_version
  on deliveries (proposal_id) where status = 'sent';

-- ---------------------------------------------------------------------------
-- activity_log
-- ---------------------------------------------------------------------------
-- Every state change, every generation ATTEMPT, every send.

create table activity_log (
  id            bigserial primary key,
  proposal_id   uuid references proposals(id) on delete cascade,
  actor_name    text,
  event         text not null
                  check (event in ('created','generated','generation_rejected',
                                   'generation_failed','regenerated',
                                   'material_summarized','intake_edited',
                                   'sections_marked_stale','submitted','approved',
                                   'changes_requested','version_forked',
                                   'sent','send_failed','rate_limited')),
  detail        text,

  -- Attempts that were thrown away still cost money. Recording tokens here and
  -- not only on the section is what makes the real spend visible.
  model_used    text,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,

  created_at    timestamptz default now()
);

-- The rate limiter counts billable events in a rolling hour across all users,
-- so this index carries a hot path rather than only reporting.
create index activity_log_event_time_idx on activity_log (event, created_at desc);
create index activity_log_proposal_idx   on activity_log (proposal_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger proposals_set_updated_at
  before update on proposals
  for each row execute function set_updated_at();
