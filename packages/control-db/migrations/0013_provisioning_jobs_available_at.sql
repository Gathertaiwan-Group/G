alter table provisioning_jobs add column if not exists available_at timestamptz default now();
create index if not exists provisioning_jobs_available_idx
  on provisioning_jobs (available_at) where status = 'queued';
