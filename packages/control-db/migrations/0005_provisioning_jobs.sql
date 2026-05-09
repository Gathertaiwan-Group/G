create table if not exists provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  step text not null,
  status text not null check (status in ('queued', 'running', 'success', 'failed')),
  attempt int default 0,
  last_error text,
  payload jsonb,
  result jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists provisioning_jobs_tenant_created_idx on provisioning_jobs (tenant_id, created_at);
create index if not exists provisioning_jobs_status_idx on provisioning_jobs (status) where status in ('queued', 'failed');
