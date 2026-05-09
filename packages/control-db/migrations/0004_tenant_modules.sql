create table if not exists tenant_modules (
  tenant_id uuid references tenants(id) on delete cascade,
  module text not null check (module in (
    'subscriptions', 'membership_tiers', 'campaigns', 'product_reviews',
    'cms_posts', 'site_notice', 'member_only_products',
    'courses', 'crowdfunding', 'bookings'
  )),
  enabled boolean default false,
  config jsonb default '{}'::jsonb,
  enabled_at timestamptz,
  primary key (tenant_id, module)
);

-- Idempotently ensure the v1 module CHECK constraint exists with the right
-- definition (handles re-runs where the table existed without it).
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'tenant_modules'
      and constraint_name = 'tenant_modules_module_check'
      and constraint_type = 'CHECK'
  ) then
    alter table tenant_modules
      add constraint tenant_modules_module_check
      check (module in (
        'subscriptions', 'membership_tiers', 'campaigns', 'product_reviews',
        'cms_posts', 'site_notice', 'member_only_products',
        'courses', 'crowdfunding', 'bookings'
      ));
  end if;
end $$;
