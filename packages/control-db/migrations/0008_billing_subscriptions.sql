create table if not exists billing_subscriptions (
  id text primary key,
  tenant_id uuid references tenants(id) on delete set null,
  status text,
  plan text,
  current_period_end timestamptz,
  raw jsonb,
  updated_at timestamptz default now()
);

create index if not exists billing_subscriptions_tenant_idx on billing_subscriptions (tenant_id);
