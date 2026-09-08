-- Minimal stand-in for the Supabase-managed pieces the migrations reference,
-- so the real migrations can be executed unmodified against plain Postgres.
-- Verification only — never part of the application's own migrations.

create schema if not exists auth;

create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase provides these; here they are settable so policies can be tested
-- as different users.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

grant usage on schema public to anon, authenticated;

-- Storage, enough of it for migration 0004's bucket and policies to apply.
create schema if not exists storage;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text not null,
  owner     uuid
);

alter table storage.objects enable row level security;

-- Supabase's own helper: splits an object name into path segments, so
-- `(storage.foldername(name))[1]` is the first folder — the proposal id.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
begin
  return string_to_array(name, '/');
end;
$$;
