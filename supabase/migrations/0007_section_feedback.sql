-- Per-section change requests.
--
-- "Request changes" was one note covering the whole proposal, which forced the
-- approver to write the location into the prose — "in the deliverables
-- section, the third bullet promises support we did not scope" — and forced
-- the salesperson to find it again by reading. The approver already knows
-- which section they mean at the moment they object to it.
--
-- These rows hang off the APPROVAL, not the proposal: a decision is a snapshot
-- of what one person said on one occasion, and the comments belong to that
-- occasion. Two rounds of review produce two approvals with their own comments,
-- and neither overwrites the other.

create table approval_comments (
  id          uuid primary key default gen_random_uuid(),
  approval_id uuid not null references approvals(id) on delete cascade,

  -- Which section this is about. Not a foreign key to proposal_sections,
  -- because a fork creates NEW section rows and the comment should still read
  -- sensibly against v2 — the key is stable across versions where a row id is
  -- not.
  section_key text not null
                check (section_key in ('introduction','solution','deliverables',
                                       'timeline','pricing','next_steps')),

  note        text not null check (length(trim(note)) > 0),
  created_at  timestamptz default now(),

  -- One comment per section per decision. An approver revising their note
  -- before submitting should update it, not stack a second one the
  -- salesperson has to reconcile.
  unique (approval_id, section_key)
);

create index approval_comments_approval_idx on approval_comments (approval_id);

comment on table approval_comments is
  'Per-section notes attached to one approval decision. The overall note on `approvals` remains for anything not about a specific section.';

-- Readable by whoever can read the approval it belongs to: the author needs to
-- act on it, the approver needs to see what they said.
alter table approval_comments enable row level security;

create policy approval_comments_read on approval_comments
  for select to authenticated
  using (
    exists (
      select 1
        from approvals a
        join proposals p on p.id = a.proposal_id
       where a.id = approval_id
         and (p.author_id = auth.uid() or is_approver())
    )
  );

-- Written only by the approver making the decision, and only alongside their
-- own approval row. The same separation of duties as `approvals` itself.
create policy approval_comments_insert on approval_comments
  for insert to authenticated
  with check (
    is_approver()
    and exists (
      select 1
        from approvals a
        join proposals p on p.id = a.proposal_id
       where a.id = approval_id
         and a.approver_id = auth.uid()
         and p.author_id <> auth.uid()
    )
  );

-- No update or delete policy, for the same reason `approvals` has none: what
-- an approver said is part of the audit trail, permanently.
