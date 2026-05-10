# Phase B Template Extraction — Deployment Record

**Date deployed:** 2026-05-10
**Tenant scope:** realreal only

## What shipped

| PR | Description |
|----|-------------|
| #18 | `packages/modules` — registry + isEnabled() + Express/Next gates |
| #19 | `packages/theme` — brand zod schema + DEFAULT_BRAND + CSS helpers |
| #20 | `apps/web` brand strings → `site_contents.brand` (literal fallbacks) |
| #21 | Brand colors → CSS custom properties (`var(--brand-*, <literal>)`) |
| #22 | Hero/banner copy → `site_contents.homepage_*` |
| #23 | Migration 0021: corrective realreal brand seed |
| #24 | `apps/api` module gating middleware |
| #25 | `apps/web` module gating wrapper |

## Live state

- **Storefront**: https://agent-web-xi.vercel.app — deployed 2026-05-10
- **API**: https://api-production-ed3c.up.railway.app — deployed 2026-05-10
- **Realreal Supabase**: ozwftlkgqmewtadypsfi (Tokyo)

### Smoke results

| Endpoint | Expected | Actual |
|----------|----------|--------|
| Storefront `/` | 200, brand from DB | 200, `<title>誠真生活 RealReal — 純淨植物力，為你的健康加分</title>` |
| `<html style>` | `--brand-primary: #10305a` (navy from DB) | confirmed |
| API `/health` | 200 | 200 |
| API `/products` | 200 (gateModule pass) | 200 |
| API `/posts` | 200 (cms_posts enabled) | 200 |
| API `/subscription-plans` | 200 (subscriptions enabled) | 200 |
| API `/membership-tiers` | 200 (membership_tiers enabled) | 200 |
| Storefront `/courses` | 404 page (courses disabled) | renders not-found body |
| Storefront `/bookings` | 404 (no page exists) | 404 |

## Module config in realreal

```json
{
  "subscriptions": true,
  "membership_tiers": true,
  "campaigns": true,
  "product_reviews": true,
  "cms_posts": true,
  "site_notice": true,
  "courses": false,
  "bookings": false,
  "crowdfunding": false,
  "member_only_products": false
}
```

## Recovery

If brand renders wrong: confirm `site_contents.brand` row exists with valid schema (see `packages/theme/src/brand.ts`). If missing, code falls back to `DEFAULT_BRAND` literals.

If a working page suddenly 404s: confirm `site_contents.module_config` value for that module is `true`. To force-enable in DB:
```sql
update site_contents
set value = jsonb_set(value, '{module_name}', 'true'::jsonb)
where key = 'module_config';
```
Cache TTL is 60s, so expect ~1 min before pages reflect the change.

## Follow-ups (deferred)

- Auth pages (`/auth/login` etc.) still hardcode `<Image src="/logo.svg">`. `BrandLogo` server component is ready; needs page-level layout slot refactor.
- `/about` page hardcodes long-form description. Move to `site_contents.about_page` if v1.5 needs per-tenant about copy.
- `member_only_products` registry has empty `routes_to_gate` / `nav_items` arrays — registry test exempts surfaceless modules.

---

# Phase C-1 — Realreal Registered as Tenant #1

**Date:** 2026-05-10

Migration `0012_tenant_infra_relax_mcp.sql` applied to control DB:
- `railway_mcp_service_id` and `railway_mcp_url` nullable (MCP service backfills in C-3)

INSERTED in control DB:
- `tenants` row: slug=realreal, status=active, owner=armand7951, plan=standard
- `tenant_infrastructure`: existing Vercel + Railway api + Supabase IDs; service_role key AES-256-GCM-encrypted with PLATFORM_KEK (247 bytes, round-trip-decrypt verified)
- `tenant_modules`: 10 modules, 6 enabled mirroring `site_contents.module_config`

Live: https://control-nu-seven.vercel.app/ shows "Active tenants: 1".
