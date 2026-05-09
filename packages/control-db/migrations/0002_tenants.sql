create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  custom_domain text unique,
  custom_domain_verified_at timestamptz,
  status text not null check (status in (
    'pending_payment', 'provisioning', 'active', 'suspended', 'canceled', 'failed'
  )),
  -- on delete restrict: never silently delete a platform_user that still owns tenants.
  owner_user_id uuid references platform_users(id) on delete restrict not null,
  plan text check (plan in ('starter', 'standard', 'pro')),
  deploy_pin_commit text,
  created_at timestamptz default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text
);

-- Idempotently enforce on delete restrict for owner_user_id (handles re-runs
-- where the table already existed with the unspecified default behavior).
do $$
begin
  if exists (
    select 1 from information_schema.referential_constraints rc
    join information_schema.table_constraints tc using (constraint_name, constraint_schema)
    where tc.table_name = 'tenants'
      and tc.constraint_name = 'tenants_owner_user_id_fkey'
      and rc.delete_rule <> 'RESTRICT'
  ) then
    alter table tenants drop constraint tenants_owner_user_id_fkey;
    alter table tenants
      add constraint tenants_owner_user_id_fkey
      foreign key (owner_user_id) references platform_users(id) on delete restrict;
  end if;
end $$;

create index if not exists tenants_status_idx on tenants (status);
create index if not exists tenants_owner_user_id_idx on tenants (owner_user_id);
