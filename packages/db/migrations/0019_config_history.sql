create table if not exists config_history (
  id uuid primary key default gen_random_uuid(),
  changed_by uuid references auth.users(id),
  config_key text not null,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz default now()
);

create index if not exists config_history_key_idx on config_history (config_key, changed_at desc);

-- Trigger: auto-write config_history when site_contents.value changes
-- Audit-write must NEVER block the underlying UPDATE: wrap the JWT-claim
-- lookup in an exception block so malformed/missing `sub` (service-role
-- calls, system jobs, non-UUID values) silently falls back to null rather
-- than aborting the parent UPDATE on site_contents.
create or replace function log_site_contents_change() returns trigger as $$
declare
  v_changed_by uuid;
begin
  if new.value is distinct from old.value then
    begin
      v_changed_by := nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
    exception when others then
      v_changed_by := null;
    end;

    insert into config_history (config_key, old_value, new_value, changed_by)
    values ('site_contents.' || new.key, old.value, new.value, v_changed_by);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists site_contents_history_trigger on site_contents;
create trigger site_contents_history_trigger
  after update on site_contents
  for each row execute function log_site_contents_change();

insert into schema_migrations (filename) values ('0019_config_history.sql') on conflict do nothing;
