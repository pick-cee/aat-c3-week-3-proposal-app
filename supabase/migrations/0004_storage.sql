-- Storage for supporting materials.
--
-- Files go directly from the browser to Storage via a signed URL (DESIGN.md
-- section 6): Vercel caps a serverless request body at 4.5MB, which a single
-- PDF clears easily, so routing uploads through a route handler would fail on
-- real files.
--
-- The bucket is PRIVATE. Materials are internal working documents — a client
-- never sees them, and the public proposal view returns only rendered sections.
-- Reads go through short-lived signed URLs issued server-side.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'materials',
  'materials',
  false,
  26214400,  -- 25MB; larger than anything Claude will accept anyway
  null       -- format policy lives in lib/materials/formats.ts, which can
             -- explain a rejection in words. A storage-level list would fail
             -- uploads with an opaque error instead.
)
on conflict (id) do nothing;

-- Objects are namespaced by proposal id: materials/<proposal_id>/<file>.
-- Access follows the proposal, so these policies mirror the ones on
-- `supporting_materials` in 0002_rls.sql.

create policy materials_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materials'
    and exists (
      select 1 from proposals p
      where p.id::text = (storage.foldername(name))[1]
        and (p.author_id = auth.uid() or (is_approver() and p.status <> 'draft'))
    )
  );

-- Upload only into your own draft — the same window in which content is
-- editable at all.
create policy materials_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materials'
    and exists (
      select 1 from proposals p
      where p.id::text = (storage.foldername(name))[1]
        and p.author_id = auth.uid()
        and p.status = 'draft'
    )
  );

create policy materials_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'materials'
    and exists (
      select 1 from proposals p
      where p.id::text = (storage.foldername(name))[1]
        and p.author_id = auth.uid()
        and p.status = 'draft'
    )
  );
