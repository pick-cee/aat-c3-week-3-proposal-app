-- Verifies the fork carries exactly what DESIGN.md section 2 says it carries.
--
-- The fork is implemented in TypeScript (`app/actions/review.ts`), so this
-- reproduces its INSERTs in SQL and asserts the resulting shape. What is being
-- checked is the specification — which columns come across, which reset, which
-- are absent — because a silently dropped column here loses a salesperson's
-- work permanently and nothing would report it.

\set ON_ERROR_STOP on

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'fork-author@koyatalent.demo'),
  ('44444444-4444-4444-4444-444444444444', 'fork-approver@koyatalent.demo');

insert into profiles (id, full_name, role) values
  ('33333333-3333-3333-3333-333333333333', 'Fork Author', 'salesperson'),
  ('44444444-4444-4444-4444-444444444444', 'Fork Approver', 'approver');

insert into proposals (
  id, version, status, author_id, author_name,
  client_name, company_name, client_email, estimated_pricing,
  field_gaps, share_token
) values (
  'bbbbbbbb-0000-0000-0000-000000000001', 1, 'approved',
  '33333333-3333-3333-3333-333333333333', 'Fork Author',
  'Dana Whitfield', 'Northwind Logistics', 'dana@northwind.example', '48000',
  '[{"field":"goals_and_objectives","tier":"mark","treatment":"noted"}]'::jsonb,
  'tok_fork_chain'
);

insert into proposal_sections (
  proposal_id, section_key, title, position, source, content,
  model_used, input_tokens, output_tokens, regenerated_count,
  edited_by_human, last_generated_at, generated_from, stale_fields
) values (
  'bbbbbbbb-0000-0000-0000-000000000001', 'introduction', 'Introduction', 1,
  'generated', 'The introduction text.',
  'claude-sonnet-5', 1200, 300, 4,
  true, now(),
  '{"client_name":"Dana Whitfield"}'::jsonb,
  '[{"kind":"intake","field":"client_name"}]'::jsonb
), (
  'bbbbbbbb-0000-0000-0000-000000000001', 'pricing', 'Pricing', 5,
  'template', 'The estimated cost is 48000',
  null, 0, 0, 0, false, null, null, '[]'::jsonb
);

insert into supporting_materials (
  id, proposal_id, filename, storage_path, mime_type, size_bytes,
  extraction_status, extracted_text, summary, summarized
) values (
  'cccccccc-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'requirements.pdf',
  'bbbbbbbb-0000-0000-0000-000000000001/1234-requirements.pdf',
  'application/pdf', 24000,
  'ok', 'Raw extracted text.', 'Haiku summary of the requirements.', true
);

insert into section_materials (section_id, material_id)
select s.id, 'cccccccc-0000-0000-0000-000000000001'
  from proposal_sections s
 where s.proposal_id = 'bbbbbbbb-0000-0000-0000-000000000001'
   and s.section_key = 'introduction';

insert into approvals (proposal_id, approver_id, approver_name, decision, note)
values ('bbbbbbbb-0000-0000-0000-000000000001',
        '44444444-4444-4444-4444-444444444444', 'Fork Approver',
        'approved', 'Looks right.');

insert into deliveries (proposal_id, intended_recipient, actual_recipient, status)
values ('bbbbbbbb-0000-0000-0000-000000000001',
        'dana@northwind.example', 'demo@example.com', 'sent');

-- The fork, mirroring app/actions/review.ts -----------------------------------
do $$
declare
  child_id uuid;
  section_map jsonb := '{}'::jsonb;
  mat_id uuid;
  old_section record;
  new_section_id uuid;
begin
  insert into proposals (
    version, parent_id, status, author_id, author_name,
    client_name, company_name, client_email, estimated_pricing,
    field_gaps, share_token
  )
  select version + 1, id, 'draft', author_id, author_name,
         client_name, company_name, client_email, estimated_pricing,
         field_gaps, share_token          -- token INHERITED, not minted
    from proposals
   where id = 'bbbbbbbb-0000-0000-0000-000000000001'
  returning id into child_id;

  for old_section in
    select * from proposal_sections
     where proposal_id = 'bbbbbbbb-0000-0000-0000-000000000001'
  loop
    insert into proposal_sections (
      proposal_id, section_key, title, position, source, content,
      generated_from, model_used, input_tokens, output_tokens,
      edited_by_human, last_generated_at, stale_fields,
      regenerated_count
    ) values (
      child_id, old_section.section_key, old_section.title,
      old_section.position, old_section.source, old_section.content,
      old_section.generated_from, old_section.model_used,
      old_section.input_tokens, old_section.output_tokens,
      old_section.edited_by_human, old_section.last_generated_at,
      old_section.stale_fields,
      0                                    -- regenerated_count RESET
    )
    returning id into new_section_id;

    section_map := section_map || jsonb_build_object(old_section.id::text, new_section_id::text);
  end loop;

  insert into supporting_materials (
    proposal_id, filename, storage_path, mime_type, size_bytes,
    extraction_status, extraction_note, extracted_text, summary, summarized
  )
  select child_id, filename, storage_path, mime_type, size_bytes,
         extraction_status, extraction_note, extracted_text, summary, summarized
    from supporting_materials
   where proposal_id = 'bbbbbbbb-0000-0000-0000-000000000001'
  returning id into mat_id;

  insert into section_materials (section_id, material_id)
  select (section_map->>sm.section_id::text)::uuid, mat_id
    from section_materials sm
    join proposal_sections s on s.id = sm.section_id
   where s.proposal_id = 'bbbbbbbb-0000-0000-0000-000000000001';

  insert into activity_log (proposal_id, actor_name, event, detail)
  values (child_id, 'Fork Author', 'version_forked', 'Version 2 created.');
end
$$;

-- Assertions -----------------------------------------------------------------
do $$
declare
  parent proposals%rowtype;
  child  proposals%rowtype;
begin
  select * into parent from proposals where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  select * into child  from proposals where parent_id = parent.id;

  if child.version <> 2 then
    raise exception 'FAIL: child version is %', child.version;
  end if;
  if child.status <> 'draft' then
    raise exception 'FAIL: child status is %', child.status;
  end if;
  raise notice 'PASS: fork creates v2 in draft, linked to the parent';

  -- Intake copied verbatim: a fork is a correction to the prose, not a new
  -- discovery call.
  if child.client_name is distinct from parent.client_name
     or child.estimated_pricing is distinct from parent.estimated_pricing then
    raise exception 'FAIL: intake was not copied verbatim';
  end if;
  if child.field_gaps is distinct from parent.field_gaps then
    raise exception 'FAIL: field_gaps was not copied';
  end if;
  raise notice 'PASS: intake and field_gaps copied verbatim';

  -- The link already in the client's inbox has to keep working.
  if child.share_token is distinct from parent.share_token then
    raise exception 'FAIL: share_token was not inherited (% vs %)',
      child.share_token, parent.share_token;
  end if;
  raise notice 'PASS: share_token inherited, so the client link still resolves';

  -- v1 must be untouched. It is the thing the approval points at.
  if parent.status <> 'approved' then
    raise exception 'FAIL: forking changed the parent status to %', parent.status;
  end if;
  raise notice 'PASS: v1 remains exactly as approved';
end
$$;

do $$
declare
  child_id uuid;
  intro    proposal_sections%rowtype;
  pricing  proposal_sections%rowtype;
  n        int;
begin
  select id into child_id from proposals
   where parent_id = 'bbbbbbbb-0000-0000-0000-000000000001';

  select count(*) into n from proposal_sections where proposal_id = child_id;
  if n <> 2 then
    raise exception 'FAIL: expected 2 sections on the fork, found %', n;
  end if;

  select * into intro from proposal_sections
   where proposal_id = child_id and section_key = 'introduction';

  -- Deep-copied, content and all: v2 opens as a readable document, not an
  -- empty shell the salesperson has to regenerate to get back to where it was.
  if intro.content is distinct from 'The introduction text.' then
    raise exception 'FAIL: section content was not carried over';
  end if;
  if intro.model_used is distinct from 'claude-sonnet-5'
     or intro.input_tokens <> 1200 then
    raise exception 'FAIL: generation metadata was not carried over';
  end if;
  if intro.edited_by_human is not true then
    raise exception 'FAIL: edited_by_human was not carried over';
  end if;
  if intro.generated_from is null then
    raise exception 'FAIL: the intake snapshot was not carried over';
  end if;
  if jsonb_array_length(intro.stale_fields) <> 1 then
    raise exception 'FAIL: stale_fields was not carried over — drift real on v1 would be hidden on v2';
  end if;
  raise notice 'PASS: sections deep-copied with content, provenance and drift state';

  -- The cap guards against thrashing one section, not a lifetime budget for a
  -- document. A v2 inheriting an exhausted count could not be regenerated at all.
  if intro.regenerated_count <> 0 then
    raise exception 'FAIL: regenerated_count was inherited as %, not reset',
      intro.regenerated_count;
  end if;
  raise notice 'PASS: regenerated_count reset to 0 on the fork';

  select * into pricing from proposal_sections
   where proposal_id = child_id and section_key = 'pricing';
  if pricing.source <> 'template' then
    raise exception 'FAIL: a template section became % on the fork', pricing.source;
  end if;
  raise notice 'PASS: template sections stay template sections';
end
$$;

do $$
declare
  child_id uuid;
  mat      supporting_materials%rowtype;
  n        int;
begin
  select id into child_id from proposals
   where parent_id = 'bbbbbbbb-0000-0000-0000-000000000001';

  select * into mat from supporting_materials where proposal_id = child_id;

  -- Re-linked, never re-summarized. A summary of an unchanged file is an
  -- unchanged summary; re-running Haiku would make a typo fix cost ten calls.
  if mat.summary is distinct from 'Haiku summary of the requirements.' then
    raise exception 'FAIL: the summary was not carried over — the fork would need model calls';
  end if;
  if mat.summarized is not true then
    raise exception 'FAIL: summarized flag was not carried over';
  end if;
  if mat.extracted_text is distinct from 'Raw extracted text.' then
    raise exception 'FAIL: extracted text was not carried over';
  end if;

  -- Both versions point at the SAME stored object. Copying the bytes would
  -- double storage for an identical file; omitting the path would leave the
  -- forked row referring to nothing, so a download or re-process would fail.
  if mat.storage_path is distinct from
     'bbbbbbbb-0000-0000-0000-000000000001/1234-requirements.pdf' then
    raise exception 'FAIL: storage_path was not carried over — the forked material points at no file';
  end if;

  raise notice 'PASS: materials row-copied with their summaries and storage path — fork costs zero model calls';

  -- Provenance survives: which materials informed which section is unchanged.
  select count(*) into n
    from section_materials sm
    join proposal_sections s on s.id = sm.section_id
   where s.proposal_id = child_id;

  if n <> 1 then
    raise exception 'FAIL: expected 1 re-pointed provenance link, found %', n;
  end if;
  raise notice 'PASS: section_materials re-pointed to the new rows';
end
$$;

do $$
declare
  child_id uuid;
  n        int;
begin
  select id into child_id from proposals
   where parent_id = 'bbbbbbbb-0000-0000-0000-000000000001';

  -- v2 has not been approved. v1's approval stays on v1, which is the entire
  -- point of versioning.
  select count(*) into n from approvals where proposal_id = child_id;
  if n <> 0 then
    raise exception 'FAIL: % approvals came across to the fork', n;
  end if;

  select count(*) into n from approvals
   where proposal_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if n <> 1 then
    raise exception 'FAIL: the parent lost its approval record';
  end if;
  raise notice 'PASS: approvals stay on v1 and do not follow the fork';

  -- v2 has not been sent.
  select count(*) into n from deliveries where proposal_id = child_id;
  if n <> 0 then
    raise exception 'FAIL: % deliveries came across to the fork', n;
  end if;
  raise notice 'PASS: deliveries do not follow the fork';

  -- Sending v2 must remain possible: the partial unique index is per version,
  -- so v1 having succeeded cannot block v2.
  insert into deliveries (proposal_id, intended_recipient, actual_recipient, status)
  values (child_id, 'dana@northwind.example', 'demo@example.com', 'sent');
  raise notice 'PASS: v2 can be sent even though v1 already was';
end
$$;

-- Both versions reference the same stored object -----------------------------
do $$
declare
  n int;
begin
  select count(distinct proposal_id) into n
    from supporting_materials
   where storage_path = 'bbbbbbbb-0000-0000-0000-000000000001/1234-requirements.pdf';

  if n <> 2 then
    raise exception 'FAIL: expected 2 versions sharing one object, found %', n;
  end if;

  -- This is why `deleteMaterial` counts other references before removing the
  -- bytes: dropping the file from v2 must not gut the approved v1.
  raise notice 'PASS: v1 and v2 share one stored object, so deletion must be reference-counted';
end
$$;

-- The client link follows the chain forward once v2 is sent -------------------
do $$
declare
  child_id uuid;
  result   jsonb;
begin
  select id into child_id from proposals
   where parent_id = 'bbbbbbbb-0000-0000-0000-000000000001';

  update proposals set status = 'sent' where id = child_id;

  select get_shared_proposal('tok_fork_chain') into result;

  if (result->>'version')::int <> 2 then
    raise exception 'FAIL: the inherited token still resolves to v%',
      result->>'version';
  end if;
  raise notice 'PASS: the original client link now serves v2';
end
$$;
