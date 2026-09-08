-- Row-level security. DESIGN.md section 10: RLS on every table.
--
-- These policies are a second line, not the only one. The state-machine rules
-- (only `draft` is editable, the approver cannot be the author, only the author
-- sends) are enforced in the API where they can return a plain-language reason.
-- What RLS guarantees is that a bug or a forged request in that layer cannot
-- read or write rows the signed-in user has no business touching.
--
-- Where a rule is cheap to express here as well, it is expressed here as well —
-- content being editable only in `draft` is the clearest example.

alter table profiles             enable row level security;
alter table proposals            enable row level security;
alter table proposal_sections    enable row level security;
alter table supporting_materials enable row level security;
alter table section_materials    enable row level security;
alter table approvals            enable row level security;
alter table deliveries           enable row level security;
alter table activity_log         enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- `stable` so the planner calls these once per statement rather than per row.

create or replace function current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_approver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_role_name() = 'approver', false);
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Everyone signed in can read profiles: the queue shows author names, and the
-- review screen has to say who wrote what. Nobody writes them through the API —
-- seeding uses the service role.

create policy profiles_read_authenticated on profiles
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- proposals
-- ---------------------------------------------------------------------------
-- A salesperson sees their own. An approver sees anything that has left draft —
-- reviewing means reading work you did not write, but a draft is private until
-- its author submits it.

create policy proposals_read on proposals
  for select to authenticated
  using (
    author_id = auth.uid()
    or (is_approver() and status <> 'draft')
  );

create policy proposals_insert_own on proposals
  for insert to authenticated
  with check (author_id = auth.uid());

-- Deliberately permissive on the row filter and strict on nothing here: which
-- transitions are legal is the API's job, because only the API can explain why
-- one was refused. RLS's job is that a stranger cannot touch the row at all.
create policy proposals_update_own on proposals
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- Approvers change status when they decide. They can never alter content —
-- that is enforced by column ownership in the API and by the fact that this
-- policy is the only write path they have.
create policy proposals_update_as_approver on proposals
  for update to authenticated
  using (is_approver() and status = 'in_review' and author_id <> auth.uid())
  with check (is_approver() and author_id <> auth.uid());

-- ---------------------------------------------------------------------------
-- proposal_sections
-- ---------------------------------------------------------------------------

create policy sections_read on proposal_sections
  for select to authenticated
  using (
    exists (
      select 1 from proposals p
      where p.id = proposal_id
        and (p.author_id = auth.uid() or (is_approver() and p.status <> 'draft'))
    )
  );

-- Rule 1, in the database as well as the API: content is editable only in
-- `draft`. This one is cheap to express here and worth the belt and braces —
-- it is the rule most likely to be bypassed by a forgotten guard on a new route.
create policy sections_write_draft_only on proposal_sections
  for all to authenticated
  using (
    exists (
      select 1 from proposals p
      where p.id = proposal_id
        and p.author_id = auth.uid()
        and p.status = 'draft'
    )
  )
  with check (
    exists (
      select 1 from proposals p
      where p.id = proposal_id
        and p.author_id = auth.uid()
        and p.status = 'draft'
    )
  );

-- ---------------------------------------------------------------------------
-- supporting_materials
-- ---------------------------------------------------------------------------

create policy materials_read on supporting_materials
  for select to authenticated
  using (
    exists (
      select 1 from proposals p
      where p.id = proposal_id
        and (p.author_id = auth.uid() or (is_approver() and p.status <> 'draft'))
    )
  );

create policy materials_write_draft_only on supporting_materials
  for all to authenticated
  using (
    exists (
      select 1 from proposals p
      where p.id = proposal_id
        and p.author_id = auth.uid()
        and p.status = 'draft'
    )
  )
  with check (
    exists (
      select 1 from proposals p
      where p.id = proposal_id
        and p.author_id = auth.uid()
        and p.status = 'draft'
    )
  );

-- ---------------------------------------------------------------------------
-- section_materials
-- ---------------------------------------------------------------------------

create policy section_materials_read on section_materials
  for select to authenticated
  using (
    exists (
      select 1 from proposal_sections s
      join proposals p on p.id = s.proposal_id
      where s.id = section_id
        and (p.author_id = auth.uid() or (is_approver() and p.status <> 'draft'))
    )
  );

create policy section_materials_write on section_materials
  for all to authenticated
  using (
    exists (
      select 1 from proposal_sections s
      join proposals p on p.id = s.proposal_id
      where s.id = section_id
        and p.author_id = auth.uid()
        and p.status = 'draft'
    )
  )
  with check (
    exists (
      select 1 from proposal_sections s
      join proposals p on p.id = s.proposal_id
      where s.id = section_id
        and p.author_id = auth.uid()
        and p.status = 'draft'
    )
  );

-- ---------------------------------------------------------------------------
-- approvals
-- ---------------------------------------------------------------------------
-- Readable by the author (they need to see the note) and by approvers.

create policy approvals_read on approvals
  for select to authenticated
  using (
    exists (
      select 1 from proposals p
      where p.id = proposal_id
        and (p.author_id = auth.uid() or is_approver())
    )
  );

-- Rule 3, in the database: the approver cannot be the author. The API enforces
-- this too and returns an explanation; here it is a hard floor that no forged
-- request gets under.
create policy approvals_insert on approvals
  for insert to authenticated
  with check (
    approver_id = auth.uid()
    and is_approver()
    and exists (
      select 1 from proposals p
      where p.id = proposal_id
        and p.author_id <> auth.uid()
    )
  );

-- No update or delete policy. An approval decision is permanent — that is the
-- entire point of keeping it tied to a version.

-- ---------------------------------------------------------------------------
-- deliveries
-- ---------------------------------------------------------------------------
-- Written server-side during a send. Readable by the people who need to know
-- whether the client actually got it.

create policy deliveries_read on deliveries
  for select to authenticated
  using (
    exists (
      select 1 from proposals p
      where p.id = proposal_id
        and (p.author_id = auth.uid() or is_approver())
    )
  );

-- ---------------------------------------------------------------------------
-- activity_log
-- ---------------------------------------------------------------------------
-- Read-only to users. Every write goes through the service role, so a client
-- cannot forge or suppress an audit entry — an audit trail a user can edit is
-- not an audit trail.

create policy activity_log_read on activity_log
  for select to authenticated
  using (
    proposal_id is null
    or exists (
      select 1 from proposals p
      where p.id = proposal_id
        and (p.author_id = auth.uid() or is_approver())
    )
  );
