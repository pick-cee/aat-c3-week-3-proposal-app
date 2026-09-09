-- Behavioural verification of the schema guarantees DESIGN.md relies on.
-- Each block asserts and raises if the database does not actually enforce it.

\set ON_ERROR_STOP on

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'sam@koyatalent.demo'),
  ('22222222-2222-2222-2222-222222222222', 'avery@koyatalent.demo');

insert into profiles (id, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'Sam Okafor', 'salesperson'),
  ('22222222-2222-2222-2222-222222222222', 'Avery Lindqvist', 'approver');

insert into proposals (id, version, status, author_id, author_name, client_name,
                       company_name, client_email, share_token)
values ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'approved',
        '11111111-1111-1111-1111-111111111111', 'Sam Okafor',
        'Dana Whitfield', 'Northwind Logistics', 'dana@northwind.example',
        'tok_chain_one');

insert into proposal_sections (proposal_id, section_key, title, position, source, content)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'introduction', 'Introduction', 1, 'generated', 'Intro text.'),
       ('aaaaaaaa-0000-0000-0000-000000000001', 'pricing', 'Pricing', 5, 'template', 'GBP 48,000');

-- 1. Idempotency: one successful delivery per version, enforced by the index --
do $$
begin
  insert into deliveries (proposal_id, intended_recipient, actual_recipient, status)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'dana@northwind.example', 'demo@example.com', 'sent');

  begin
    insert into deliveries (proposal_id, intended_recipient, actual_recipient, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'dana@northwind.example', 'demo@example.com', 'sent');
    raise exception 'FAIL: a second successful delivery was allowed';
  exception when unique_violation then
    raise notice 'PASS: second send of the same version refused by the database';
  end;
end
$$;

-- Failed attempts must remain unconstrained: retrying is the whole point.
do $$
begin
  insert into deliveries (proposal_id, intended_recipient, actual_recipient, status, attempt)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'dana@northwind.example', 'demo@example.com', 'failed', 1),
         ('aaaaaaaa-0000-0000-0000-000000000001', 'dana@northwind.example', 'demo@example.com', 'failed', 2);
  raise notice 'PASS: repeated failed attempts allowed';
end
$$;

-- 2. send_failed is not a proposal status ------------------------------------
do $$
begin
  update proposals set status = 'send_failed'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  raise exception 'FAIL: send_failed was accepted as a status';
exception when check_violation then
  raise notice 'PASS: send_failed rejected as a proposal status';
end
$$;

-- 3. A template section cannot carry generation metadata ---------------------
do $$
begin
  update proposal_sections
     set model_used = 'claude-sonnet-5'
   where proposal_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and section_key = 'pricing';
  raise exception 'FAIL: a template section accepted a model_used';
exception when check_violation then
  raise notice 'PASS: template section refused generation metadata';
end
$$;

do $$
begin
  update proposal_sections
     set regenerated_count = 1
   where proposal_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and section_key = 'pricing';
  raise exception 'FAIL: a template section accepted a regeneration count';
exception when check_violation then
  raise notice 'PASS: template section refused a regeneration count';
end
$$;

-- 4. The client-view function ------------------------------------------------
do $$
declare
  result jsonb;
begin
  -- Unknown token returns null.
  select get_shared_proposal('tok_does_not_exist') into result;
  if result is not null then
    raise exception 'FAIL: unknown token returned data';
  end if;
  raise notice 'PASS: unknown token returns null';

  -- A sent version is visible, with only the allowlisted fields.
  select get_shared_proposal('tok_chain_one') into result;
  if result is null then
    raise exception 'FAIL: a sent version was not returned';
  end if;
  if result ? 'author_id' or result ? 'field_gaps' or result ? 'client_email' then
    raise exception 'FAIL: internal fields leaked to the public view: %', result;
  end if;
  if jsonb_array_length(result->'sections') <> 2 then
    raise exception 'FAIL: expected 2 sections, got %', result->'sections';
  end if;
  raise notice 'PASS: sent version returned with only public fields';
end
$$;

-- 5. An unsent draft fork is invisible to the inherited token ----------------
insert into proposals (id, version, parent_id, status, author_id, author_name,
                       client_name, company_name, share_token)
values ('aaaaaaaa-0000-0000-0000-000000000002', 2,
        'aaaaaaaa-0000-0000-0000-000000000001', 'draft',
        '11111111-1111-1111-1111-111111111111', 'Sam Okafor',
        'Dana Whitfield', 'Northwind Logistics', 'tok_chain_one');

insert into proposal_sections (proposal_id, section_key, title, position, source, content)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'introduction', 'Introduction', 1, 'generated', 'DRAFT v2 — must never be public.');

do $$
declare
  result jsonb;
begin
  select get_shared_proposal('tok_chain_one') into result;

  if (result->>'version')::int <> 1 then
    raise exception 'FAIL: token resolved to unsent v2 (version %)', result->>'version';
  end if;

  if result::text like '%must never be public%' then
    raise exception 'FAIL: draft content leaked through the share token';
  end if;

  raise notice 'PASS: unsent fork invisible; token still resolves to v1';
end
$$;

-- 6. Once v2 is sent, the same token follows it forward ----------------------
update proposals set status = 'sent' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
insert into deliveries (proposal_id, intended_recipient, actual_recipient, status)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'dana@northwind.example', 'demo@example.com', 'sent');

do $$
declare
  result jsonb;
begin
  select get_shared_proposal('tok_chain_one') into result;

  if (result->>'version')::int <> 2 then
    raise exception 'FAIL: token did not follow to the newly sent v2';
  end if;
  if (result->>'is_superseded')::boolean is not true then
    raise exception 'FAIL: superseded flag not set on v2';
  end if;
  if result->>'first_sent_at' is null then
    raise exception 'FAIL: first_sent_at missing, so the page cannot date the change';
  end if;

  raise notice 'PASS: token follows to v2 and reports it supersedes v1';
end
$$;

-- 7. An approval decision is permanent (no update/delete policy) -------------
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_policies
   where tablename = 'approvals' and cmd in ('UPDATE', 'DELETE');
  if n > 0 then
    raise exception 'FAIL: approvals has % update/delete policies', n;
  end if;
  raise notice 'PASS: approvals has no update or delete policy';
end
$$;

-- 8. The materials bucket is private -----------------------------------------
do $$
declare
  is_public boolean;
begin
  select public into is_public from storage.buckets where id = 'materials';

  if is_public is null then
    raise exception 'FAIL: the materials bucket was not created';
  end if;

  -- Supporting materials are internal working documents. A public bucket would
  -- put every uploaded file on a guessable URL.
  if is_public then
    raise exception 'FAIL: the materials bucket is PUBLIC';
  end if;

  raise notice 'PASS: materials bucket exists and is private';
end
$$;

-- 9. Storage has RLS and no anonymous access ---------------------------------
do $$
declare
  n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'FAIL: RLS is not enabled on storage.objects';
  end if;

  select count(*) into n
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and 'anon' = any(roles);

  if n > 0 then
    raise exception 'FAIL: % storage policies grant access to anon', n;
  end if;

  raise notice 'PASS: storage locked to authenticated users only';
end
$$;

-- 10. RLS is enabled on every application table ------------------------------
do $$
declare
  unprotected text;
begin
  select string_agg(c.relname, ', ')
    into unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  if unprotected is not null then
    raise exception 'FAIL: RLS missing on %', unprotected;
  end if;
  raise notice 'PASS: RLS enabled on every public table';
end
$$;

-- 11. Extraction columns and events -------------------------------------------
do $$
begin
  perform 1 from information_schema.columns
   where table_name = 'proposals' and column_name in ('raw_notes','field_provenance')
   having count(*) = 2;
  if not found then
    raise exception 'FAIL: raw_notes / field_provenance missing from proposals';
  end if;
  raise notice 'PASS: extraction columns present';
end
$$;

do $$
declare
  pid uuid;
begin
  select id into pid from proposals limit 1;

  -- Both new events must be legal, or the rate limiter would count an event
  -- the database rejects and silently read zero.
  insert into activity_log (proposal_id, event, model_used, input_tokens, output_tokens)
  values (pid, 'intake_extracted', 'claude-sonnet-5', 1200, 300);

  insert into activity_log (proposal_id, event)
  values (pid, 'intake_confirmed');

  raise notice 'PASS: intake_extracted and intake_confirmed accepted';
end
$$;

do $$
begin
  begin
    insert into activity_log (proposal_id, event)
    select id, 'not_a_real_event' from proposals limit 1;
    raise exception 'FAIL: an unknown event was accepted';
  exception when check_violation then
    raise notice 'PASS: unknown events still rejected';
  end;
end
$$;

-- 12. Per-section approval comments -------------------------------------------
do $$
declare
  aid uuid;
begin
  insert into approvals (proposal_id, approver_id, approver_name, decision, note)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222', 'Avery Lindqvist',
          'changes_requested', 'Overall note.')
  returning id into aid;

  insert into approval_comments (approval_id, section_key, note)
  values (aid, 'deliverables', 'Promises support we did not scope.');

  -- One comment per section per decision: a revised note replaces, it does not
  -- stack a second one the salesperson has to reconcile.
  begin
    insert into approval_comments (approval_id, section_key, note)
    values (aid, 'deliverables', 'A second note on the same section.');
    raise exception 'FAIL: duplicate section comment accepted';
  exception when unique_violation then
    raise notice 'PASS: one comment per section per decision';
  end;

  -- An empty note is not feedback.
  begin
    insert into approval_comments (approval_id, section_key, note)
    values (aid, 'pricing', '   ');
    raise exception 'FAIL: blank note accepted';
  exception when check_violation then
    raise notice 'PASS: blank section notes rejected';
  end;

  -- Only real sections.
  begin
    insert into approval_comments (approval_id, section_key, note)
    values (aid, 'not_a_section', 'x');
    raise exception 'FAIL: unknown section_key accepted';
  exception when check_violation then
    raise notice 'PASS: unknown section keys rejected';
  end;
end
$$;

do $$
declare
  n int;
begin
  -- Comments follow their decision, which is permanent.
  select count(*) into n from pg_policies
   where tablename = 'approval_comments' and cmd in ('UPDATE','DELETE');
  if n > 0 then
    raise exception 'FAIL: approval_comments has % update/delete policies', n;
  end if;
  raise notice 'PASS: approval comments are permanent, like the decision';

  if not (select relrowsecurity from pg_class
           where oid = 'approval_comments'::regclass) then
    raise exception 'FAIL: RLS not enabled on approval_comments';
  end if;
  raise notice 'PASS: RLS enabled on approval_comments';
end
$$;

-- 13. Delivery attempts are numbered by the database ---------------------------
do $$
declare
  a1 int; a2 int; a3 int;
  fresh uuid;
begin
  -- A proposal with NO delivery history, so the numbering starts where a real
  -- first send would. (An earlier block in this file already sent from the
  -- other two.)
  insert into proposals (version, status, author_id, author_name, share_token)
  values (1, 'approved', '11111111-1111-1111-1111-111111111111', 'Sam Okafor',
          'tok_attempts')
  returning id into fresh;

  insert into deliveries (proposal_id, intended_recipient, actual_recipient, status)
  values (fresh,'d@x.com','demo@x.com','failed')
  returning attempt into a1;

  insert into deliveries (proposal_id, intended_recipient, actual_recipient, status)
  values (fresh,'d@x.com','demo@x.com','failed')
  returning attempt into a2;

  insert into deliveries (proposal_id, intended_recipient, actual_recipient, status)
  values (fresh,'d@x.com','demo@x.com','failed')
  returning attempt into a3;

  -- The application used to compute this as count(*)+1 before the send, so two
  -- clicks produced "Attempt 1" twice and the record of what was tried was wrong.
  if a1 <> 1 or a2 <> 2 or a3 <> 3 then
    raise exception 'FAIL: attempts numbered %, %, % — expected 1, 2, 3', a1, a2, a3;
  end if;
  raise notice 'PASS: successive attempts numbered 1, 2, 3 by the database';
end
$$;

do $$
declare
  n int;
begin
  -- Numbering is per proposal, not global.
  select attempt into n
    from deliveries
   where proposal_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   order by created_at limit 1;

  if n <> 1 then
    raise exception 'FAIL: first attempt on another proposal numbered %', n;
  end if;
  raise notice 'PASS: attempt numbering is per proposal';
end
$$;

-- 14. Deliveries are not writable by users ------------------------------------
do $$
declare
  n int;
begin
  -- The rows record what the SYSTEM did. A user who could write them could
  -- claim a proposal was sent when it never was, so the app uses the service
  -- role and there is deliberately no insert policy.
  select count(*) into n from pg_policies
   where tablename = 'deliveries' and cmd in ('INSERT','UPDATE','DELETE');
  if n > 0 then
    raise exception 'FAIL: deliveries has % user-write policies', n;
  end if;
  raise notice 'PASS: deliveries writable only via the service role';
end
$$;
