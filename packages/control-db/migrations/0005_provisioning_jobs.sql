create table if not exists provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  -- every provisioning job is for a specific tenant; never null.
  tenant_id uuid references tenants(id) on delete cascade not null,
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

-- Idempotently enforce NOT NULL on tenant_id for re-runs where the column
-- existed as nullable.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'provisioning_jobs'
      and column_name = 'tenant_id'
      and is_nullable = 'YES'
  ) then
    alter table provisioning_jobs alter column tenant_id set not null;
  end if;
end $$;

create index if not exists provisioning_jobs_tenant_created_idx on provisioning_jobs (tenant_id, created_at);
create index if not exists provisioning_jobs_status_idx on provisioning_jobs (status) where status in ('queued', 'failed');
