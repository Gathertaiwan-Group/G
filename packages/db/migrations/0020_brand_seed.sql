-- Seed default brand (overridden at provisioning time per-tenant)
insert into site_contents (key, value)
values (
  'brand',
  '{
    "name": "RealReal",
    "tagline": "純淨植物力，為你的健康加分",
    "logo_url": "/logo.svg",
    "favicon_url": "/favicon.ico",
    "colors": {
      "primary": "#4a7c59",
      "primary_foreground": "#ffffff",
      "accent": "#e8b923",
      "background": "#fafafa",
      "foreground": "#2d3436"
    },
    "font_family": "geist"
  }'::jsonb
)
on conflict (key) do nothing;

-- Seed module_config with current realreal modules ON, derivative modules OFF
insert into site_contents (key, value)
values (
  'module_config',
  '{
    "subscriptions": true,
    "membership_tiers": true,
    "campaigns": true,
    "product_reviews": true,
    "cms_posts": true,
    "site_notice": true,
    "member_only_products": false,
    "courses": false,
    "crowdfunding": false,
    "bookings": false
  }'::jsonb
)
on conflict (key) do nothing;

insert into schema_migrations (filename) values ('0020_brand_seed.sql') on conflict do nothing;
