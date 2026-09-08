-- Intake extraction (DESIGN.md section 5).
--
-- The intake form was asking the salesperson to write the proposal: four of its
-- eleven fields are the substance of the document. This adds a stage before it —
-- raw notes in, proposed fields out, human confirms — so the form becomes a
-- check rather than a composition task.

alter table proposals
  -- Kept verbatim. Extraction reads this; it is never shown to the client and
  -- never sent to section generation, which sees only confirmed intake fields.
  add column raw_notes text,

  -- Where each intake value came from, when extraction proposed it:
  --   {"client_name": {"source": "spoke with Dana at Northwind",
  --                    "confirmed": true}}
  -- A field absent from this map was typed by hand. An edit DROPS the entry —
  -- a source phrase that no longer supports the value is worse than none,
  -- because it lends false confidence to a number nobody extracted.
  add column field_provenance jsonb not null default '{}'::jsonb;

comment on column proposals.raw_notes is
  'Discovery-call notes as typed. Input to extraction only; never reaches the client or section generation.';

comment on column proposals.field_provenance is
  'Per-field {source, confirmed} for extracted values. Dropped on hand-edit.';

-- Two new events, both model-call-adjacent:
--   intake_extracted — a Sonnet call, and therefore billable against the
--                      hourly limit (see lib/rate-limit.ts BILLABLE_EVENTS)
--   intake_confirmed — a human accepting the proposed values, which is what
--                      the commercial-terms guarantee now rests on
alter table activity_log
  drop constraint if exists activity_log_event_check;

alter table activity_log
  add constraint activity_log_event_check
  check (event in ('created','intake_extracted','intake_confirmed',
                   'generated','generation_rejected','generation_failed',
                   'regenerated','material_summarized','intake_edited',
                   'sections_marked_stale','submitted','approved',
                   'changes_requested','version_forked',
                   'sent','send_failed','rate_limited'));
