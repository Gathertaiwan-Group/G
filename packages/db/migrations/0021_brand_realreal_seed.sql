-- Reconcile site_contents.brand with realreal's actual rendered values.
-- Migration 0020_brand_seed.sql seeded placeholder values (green primary,
-- yellow accent, geist font, "RealReal" name). Phase B treats site_contents.brand
-- as the source of truth for storefront rendering, so this overwrite is required
-- to restore visual parity with what realreal customers have always seen.
--
-- Idempotent: safe to re-apply. Scope: realreal Supabase only — future tenants
-- get their own brand seeded at provisioning time and this migration is skipped
-- via schema_migrations.

update site_contents
set
  value = '{
    "name": "誠真生活 RealReal",
    "tagline": "純淨植物力，為你的健康加分",
    "logo_url": "/logo.svg",
    "favicon_url": "/favicon.ico",
    "colors": {
      "primary": "#10305a",
      "primary_foreground": "#ffffff",
      "accent": "#fffeee",
      "background": "#ffffff",
      "foreground": "#687279"
    },
    "font_family": "gill-sans"
  }'::jsonb,
  updated_at = now()
where key = 'brand';

-- module_config from 0020 already matches realreal's currently-used modules
-- (subscriptions / membership_tiers / campaigns / product_reviews / cms_posts /
-- site_notice all true; courses / bookings / crowdfunding / member_only_products
-- false). No override needed.

insert into schema_migrations (filename) values ('0021_brand_realreal_seed.sql')
on conflict do nothing;
