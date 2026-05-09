create table if not exists stripe_webhook_events (
  event_id text primary key,
  -- stripe events always have a type; never null.
  type text not null,
  payload jsonb,
  processed_at timestamptz default now()
);

-- Idempotently enforce NOT NULL on type for re-runs where the column
-- existed as nullable.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'stripe_webhook_events'
      and column_name = 'type'
      and is_nullable = 'YES'
  ) then
    alter table stripe_webhook_events alter column type set not null;
  end if;
end $$;
