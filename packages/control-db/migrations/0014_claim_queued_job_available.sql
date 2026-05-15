create or replace function claim_queued_job() returns provisioning_jobs as $$
declare
  job provisioning_jobs;
begin
  update provisioning_jobs
  set status = 'running',
      attempt = attempt + 1,
      started_at = now()
  where id = (
    select id from provisioning_jobs
    where status = 'queued'
      and available_at <= now()
    order by created_at
    for update skip locked
    limit 1
  )
  returning * into job;
  return job;
end;
$$ language plpgsql security definer;
