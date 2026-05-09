create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  -- on delete set null: preserve audit history when a tenant is deleted.
  tenant_id uuid references tenants(id) on delete set null,
  actor_type text not null check (actor_type in ('platform_admin', 'customer_agent', 'system', 'customer_user')),
  actor_id text,
  action text not null,
  resource text,
  payload jsonb,
  created_at timestamptz default now()
);

-- Idempotently enforce on delete set null for re-runs where the FK was
-- created without an explicit delete rule.
do $$
begin
  if exists (
    select 1 from information_schema.referential_constraints rc
    join information_schema.table_constraints tc using (constraint_name, constraint_schema)
    where tc.table_name = 'audit_log'
      and tc.constraint_name = 'audit_log_tenant_id_fkey'
      and rc.delete_rule <> 'SET NULL'
  ) then
    alter table audit_log drop constraint audit_log_tenant_id_fkey;
    alter table audit_log
      add constraint audit_log_tenant_id_fkey
      foreign key (tenant_id) references tenants(id) on delete set null;
  end if;
end $$;

create index if not exists audit_log_tenant_created_idx on audit_log (tenant_id, created_at desc);
create index if not exists audit_log_actor_created_idx on audit_log (actor_type, created_at desc);
