create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  actor_type text not null check (actor_type in ('platform_admin', 'customer_agent', 'system', 'customer_user')),
  actor_id text,
  action text not null,
  resource text,
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists audit_log_tenant_created_idx on audit_log (tenant_id, created_at desc);
create index if not exists audit_log_actor_created_idx on audit_log (actor_type, created_at desc);
