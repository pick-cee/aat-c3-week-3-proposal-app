-- Fixes storage access for forked versions.
--
-- Objects are stored under the proposal that first uploaded them:
--   materials/<proposal_id>/<file>
--
-- A fork RE-LINKS materials rather than copying the bytes (DESIGN.md section 2),
-- so v2's `supporting_materials` rows point at objects sitting under v1's
-- folder. The original policies resolved that path segment to v1 and checked
-- ITS author and status — which happened to work for the author, because the
-- author is the same person across a chain, and happened to work for an
-- approver only because v1 was usually already `approved`.
--
-- Working by coincidence is not the same as working. An approver reviewing v2
-- of a chain whose v1 was never submitted would be refused, and the failure
-- would look like a missing file rather than a permissions rule.
--
-- These policies resolve the folder to a proposal and then consider the WHOLE
-- CHAIN it belongs to, which is what the re-linking model actually implies.

drop policy if exists materials_read on storage.objects;
drop policy if exists materials_insert on storage.objects;
drop policy if exists materials_delete on storage.objects;

-- Every proposal sharing a chain with the one that owns this folder.
-- `share_token` identifies a chain: it is minted once on the root and inherited
-- by every fork, which makes it the cheapest correct join.
create or replace function public.chain_of_folder(folder text)
returns setof proposals
language sql
stable
security definer
set search_path = public
as $$
  select chain.*
    from proposals owner
    join proposals chain on chain.share_token = owner.share_token
   where owner.id::text = folder;
$$;

revoke all on function public.chain_of_folder(text) from public;
grant execute on function public.chain_of_folder(text) to authenticated;

create policy materials_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materials'
    and exists (
      select 1
        from public.chain_of_folder((storage.foldername(name))[1]) p
       where p.author_id = auth.uid()
          or (is_approver() and p.status <> 'draft')
    )
  );

-- Writes stay scoped to the version that owns the folder: you upload into your
-- own draft, and a fork's new uploads go under the fork's own id.
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

-- Deletion is deliberately NOT chain-wide. Removing a material from v2 must not
-- delete the bytes that v1 — an approved, possibly already-sent version — still
-- references. The application deletes the row; the object survives as long as
-- any version in the chain is not a draft.
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
    and not exists (
      select 1
        from public.chain_of_folder((storage.foldername(name))[1]) other
       where other.status <> 'draft'
    )
  );
