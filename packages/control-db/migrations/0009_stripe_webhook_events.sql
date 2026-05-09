create table if not exists stripe_webhook_events (
  event_id text primary key,
  type text,
  payload jsonb,
  processed_at timestamptz default now()
);
