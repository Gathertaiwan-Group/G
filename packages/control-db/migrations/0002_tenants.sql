create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  custom_domain text unique,
  custom_domain_verified_at timestamptz,
  status text not null check (status in (
    'pending_payment', 'provisioning', 'active', 'suspended', 'canceled', 'failed'
  )),
  owner_user_id uuid references platform_users(id) not null,
  plan text check (plan in ('starter', 'standard', 'pro')),
  deploy_pin_commit text,
  created_at timestamptz default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text
);

create index if not exists tenants_status_idx on tenants (status);
create index if not exists tenants_owner_user_id_idx on tenants (owner_user_id);
