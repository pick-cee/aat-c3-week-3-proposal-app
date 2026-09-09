-- Attempt numbers assigned by the database.
--
-- `attempt` was computed in the application as `count(*) + 1` before the send,
-- which is a read-then-write: two clicks a second apart both read the same
-- count and both write the same number. The history then shows "Attempt 1"
-- twice, and the record of what was actually tried is wrong.
--
-- The same shape of bug as the send idempotency this schema already guards
-- against with a partial unique index — and the same fix: let the database
-- decide, because it is the only thing that sees both writers.

create or replace function assign_delivery_attempt()
returns trigger
language plpgsql
as $$
begin
  -- Only when the caller has not set one. `attempt` carries a DEFAULT of 1 in
  -- the original schema, so "is null" alone would never fire — but treating a
  -- literal 1 as "unset" would silently overwrite a backfill that meant it.
  --
  -- The default is therefore dropped below, which makes null mean null.
  if new.attempt is null then
    select coalesce(max(attempt), 0) + 1
      into new.attempt
      from deliveries
     where proposal_id = new.proposal_id;
  end if;

  return new;
end;
$$;

-- Without this the column defaults to 1, which the trigger cannot distinguish
-- from a caller that deliberately said 1.
alter table deliveries alter column attempt drop default;

create trigger deliveries_assign_attempt
  before insert on deliveries
  for each row execute function assign_delivery_attempt();

comment on function assign_delivery_attempt() is
  'Numbers delivery attempts server-side. The application must not compute this: a read-then-write races itself on a double-click.';
