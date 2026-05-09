create table if not exists tenant_health_log (
  id uuid primary key default gen_random_uuid(),
  -- on delete cascade: health rows have no value once the tenant is gone.
  tenant_id uuid references tenants(id) on delete cascade,
  checked_at timestamptz default now(),
  vercel_ok boolean,
  api_ok boolean,
  mcp_ok boolean,
  supabase_ok boolean,
  details jsonb
);

-- Idempotently enforce on delete cascade for re-runs where the FK was
-- created without an explicit delete rule.
do $$
begin
  if exists (
    select 1 from information_schema.referential_constraints rc
    join information_schema.table_constraints tc using (constraint_name, constraint_schema)
    where tc.table_name = 'tenant_health_log'
      and tc.constraint_name = 'tenant_health_log_tenant_id_fkey'
      and rc.delete_rule <> 'CASCADE'
  ) then
    alter table tenant_health_log drop constraint tenant_health_log_tenant_id_fkey;
    alter table tenant_health_log
      add constraint tenant_health_log_tenant_id_fkey
      foreign key (tenant_id) references tenants(id) on delete cascade;
  end if;
end $$;

create index if not exists tenant_health_log_tenant_checked_idx on tenant_health_log (tenant_id, checked_at desc);
