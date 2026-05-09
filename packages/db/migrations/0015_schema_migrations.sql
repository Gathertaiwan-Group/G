create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz default now()
);

-- Backfill: realreal already had 0001..0014 applied historically. Mark them as applied.
insert into schema_migrations (filename) values
  ('0001_initial.sql'),
  ('0002_catalog_search.sql'),
  ('0003_invoice_extensions.sql'),
  ('0004_subscription_plans_seed.sql'),
  ('0005_cms_tables.sql'),
  ('0006_campaigns_tier_marketing.sql'),
  ('0007_wp_membership_data.sql'),
  ('0008_product_reviews.sql'),
  ('0009_product_detail_columns.sql'),
  ('0009_seed_products.sql'),
  ('0010_stock_deduction_rpc.sql'),
  ('0011_campaign_promo_types.sql'),
  ('0012_email_templates.sql'),
  ('0013_product_excerpt.sql'),
  ('0014_storage_rls.sql')
on conflict do nothing;

insert into schema_migrations (filename) values ('0015_schema_migrations.sql') on conflict do nothing;
