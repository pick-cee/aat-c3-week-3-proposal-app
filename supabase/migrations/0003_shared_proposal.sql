-- The public client view. DESIGN.md section 4, "The client-view function".
--
-- The page is unauthenticated, so it satisfies no RLS policy written for
-- signed-in users. `security definer` is therefore required — and that makes
-- this function's scoping the only thing standing between a share token and
-- the whole database. It is written narrowly on purpose.
--
-- Three rules it must keep:
--   1. Resolve to the most recent version in the chain WITH A SUCCESSFUL
--      DELIVERY. A token never exposes a draft, an unsent fork, or a version
--      still in review.
--   2. Return only what the document renders. Not author_id, not field_gaps,
--      not internal ids, not the delivery rows.
--   3. Return null identically for an unknown token and for a chain with
--      nothing sent. An error that distinguishes them is an oracle for
--      guessing tokens.

create or replace function public.get_shared_proposal(token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target        proposals%rowtype;
  first_sent_at timestamptz;
  result        jsonb;
begin
  -- Rule 1: latest version in this chain that actually reached the client.
  -- `join deliveries` is what enforces it — without that join a draft fork
  -- would be visible the moment it was created.
  select p.*
    into target
    from proposals p
    join deliveries d
      on d.proposal_id = p.id
     and d.status = 'sent'
   where p.share_token = token
   order by p.version desc
   limit 1;

  -- Rule 3: unknown token and no-sent-version return the same thing.
  if not found then
    return null;
  end if;

  -- When this is not the first version the client saw, the page says so.
  -- Section 8: a document that changes under a reader with no acknowledgement
  -- is its own kind of dishonesty.
  select min(d.created_at)
    into first_sent_at
    from deliveries d
    join proposals p on p.id = d.proposal_id
   where p.share_token = token
     and d.status = 'sent';

  -- Rule 2: an explicit allowlist. Built field by field rather than with
  -- `to_jsonb(target)`, so a column added to `proposals` later cannot silently
  -- start reaching the public page.
  select jsonb_build_object(
    'client_name',       target.client_name,
    'company_name',      target.company_name,
    'salesperson_name',  target.salesperson_name,
    'date_of_call',      target.date_of_call,
    'version',           target.version,
    'is_superseded',     target.version > 1,
    'first_sent_at',     first_sent_at,
    'updated_at',        target.updated_at,
    'sections', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'title',    s.title,
                   'content',  s.content,
                   'position', s.position
                 )
                 order by s.position
               )
          from proposal_sections s
         where s.proposal_id = target.id
      ),
      '[]'::jsonb
    )
  )
  into result;

  return result;
end;
$$;

-- The anonymous role may call this and nothing else. Every other table stays
-- behind RLS with no policy for `anon`, so this function is the entire public
-- surface of the database.
revoke all on function public.get_shared_proposal(text) from public;
grant execute on function public.get_shared_proposal(text) to anon, authenticated;

comment on function public.get_shared_proposal(text) is
  'Public client view. Returns only sent versions, only rendered fields, and null identically for unknown tokens and unsent chains.';
