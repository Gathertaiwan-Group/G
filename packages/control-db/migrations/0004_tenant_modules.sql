create table if not exists tenant_modules (
  tenant_id uuid references tenants(id) on delete cascade,
  module text not null,
  enabled boolean default false,
  config jsonb default '{}'::jsonb,
  enabled_at timestamptz,
  primary key (tenant_id, module)
);
