create table if not exists tenant_health_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  checked_at timestamptz default now(),
  vercel_ok boolean,
  api_ok boolean,
  mcp_ok boolean,
  supabase_ok boolean,
  details jsonb
);

create index if not exists tenant_health_log_tenant_checked_idx on tenant_health_log (tenant_id, checked_at desc);
