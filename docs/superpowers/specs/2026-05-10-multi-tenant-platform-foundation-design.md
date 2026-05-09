# Multi-Tenant Platform Foundation — Design

> Date: 2026-05-10
> Status: Approved (brainstorming) — pending writing-plans
> Author: Armand + Claude
> Scope: Sprint 1 of multi-product roadmap. Subsequent sprints (course / crowdfund / booking modules, customer admin theme UI, BYO-domain full automation, etc.) are separate specs.

## 1. Context

### What prompted this

Realreal (誠真生活) is currently a single-tenant e-commerce site running on G repo, deployed to Vercel + Railway + Supabase Tokyo. Recent infra work moved email to Resend, made payment gateway secrets editable from the admin dashboard, and migrated all production data into the new Tokyo Supabase project (`ozwftlkgqmewtadypsfi`).

Going forward the business model is to sell similar e-commerce sites to multiple customers — each customer paying NT$10,000+/month and receiving a branded site with module toggles (subscriptions, membership tiers, campaigns, courses, crowdfunding, bookings, etc.). After signup, each customer's own LLM agent (their own Claude / Cursor) connects to a per-tenant **MCP server** to manage the site through natural language: "make homepage hero spring-themed and 80% off all products" → agent calls MCP tools → site updates.

### Why this spec exists

The current G repo is structured for one customer. Without refactoring, every additional customer is a manual fork. This spec defines the foundation that makes the system multi-tenant, modular, and agent-controllable from the ground up.

The user wants the broad vision (modules, agent control, drag-drop builder, course / crowdfund / booking) but those are scoped out — we are designing **only the foundation that enables them later**.

### Where this fits in the roadmap

| Sprint | Scope | This spec? |
|---|---|---|
| **1. Foundation (this spec)** | Control plane, tenant runtime template, MCP server, provisioning, DNS, billing | ✅ |
| 2. Existing module conversion | Toggleable subscriptions / membership / campaigns / reviews / CMS / notice / etc. | future spec |
| 3. Course module | Schema + admin UI + frontend + MCP tools | future spec |
| 4. Crowdfunding module | Schema + Stripe holds + UI + MCP tools | future spec |
| 5. Booking module | Calendar + slot + reminders + MCP tools | future spec |
| 6. Theme / brand admin UI | The drag-and-drop builder is **explicitly out**; admin UI for brand parameters is in this sprint | future spec |

Estimated effort for this sprint: **~12 weeks**.

### Decisions already locked in (from brainstorming Q1–Q11)

- **Per-tenant infrastructure** (each customer gets own Vercel project + Railway project + Supabase project)
- Customer price band: **NT$10,000+/month**, low volume / high margin
- Modular depth: **e-commerce family** (physical products + courses + subscriptions + crowdfunding + bookings — same business family, different fulfillment)
- realreal becomes **tenant #1** of the new platform (existing infra is reused, not rebuilt)
- **Customer agent = customer's own LLM** (their own Claude API key etc.); we provide an MCP server and tool catalog
- **Provisioning trigger: Stripe webhook** with full automation (no human in the loop on the happy path)
- **Domain strategy**: hybrid — platform subdomain (`<slug>.platform.realreal.cc`) is live in 5–8 minutes; BYO domain (`mybrand.com`) is auto-guided but requires customer DNS setup
- **Sender domain**: BYO-domain tenants get per-tenant DKIM (`noreply@mail.<custom-domain>`); platform-subdomain tenants share a single platform-managed sending domain (`noreply@mail.platform.realreal.cc`, with the brand name in the From header)
- **MCP deployment**: Option B — per-tenant Railway service (full isolation), 2 services per tenant Railway project
- **Theme scope**: parameterized — logo, colors, font, hero/banner copy, custom categories. **No drag-drop builder.**

---

## 2. Goals

1. Single G monorepo can deploy N independent customer sites, where each runs identical code reading from its own Supabase + env.
2. Stripe checkout → fully automated provisioning → customer site live on a platform subdomain in 5–8 minutes.
3. Each tenant exposes an MCP server that the customer's own LLM agent can connect to, exercising ~50 admin tools.
4. Modules can be toggled on/off per tenant via an admin UI; toggles take effect within 60 seconds across backend routes, frontend pages, navigation, and MCP tool catalog.
5. Existing realreal site (URL `realreal.cc`, ~30 products / 73 orders / 53 users) becomes tenant #1 with zero data loss and zero externally visible behavior change.
6. Code updates flow through main → production via a canary tenant before fanning out to all tenants, with manual approval gate.
7. Database migrations fan out to every tenant Supabase atomically (within a single deploy job), with idempotency.

## Non-goals

- Drag-and-drop visual page builder (Webflow-style)
- Course, crowdfunding, booking module **implementations** (their schemas exist; the actual frontend + admin + MCP tools are future specs)
- Customer self-service MCP token rotation UI
- Multiple admin users per tenant (v1 supports one owner admin)
- Stripe plan upgrade/downgrade flows (v1 ships one plan)
- BYO custom domain fully unattended (v1 has a "click-to-confirm" gate after customer sets DNS)
- Logging aggregation across services (Logflare / Axiom / Datadog) — v1 uses each platform's native logs
- Per-tenant version pinning (schema is reserved, behavior is not v1)

---

## 3. Architecture overview

### Three logical layers

```
┌─────────────────────────────────────────────────────────┐
│ 1. CONTROL PLANE                                         │
│    "Manage tenants, run provisioning, observe health"    │
│    Hosts:                                                │
│    - platform.realreal.cc  (Vercel, Next.js dashboard)   │
│    - platform-control       (Supabase: tenants registry) │
│    - platform-workers       (Railway: webhook + workers) │
└────────────────────────────┬────────────────────────────┘
                             │ Mgmt APIs (Vercel / Railway / Supabase / Resend / Cloudflare)
┌────────────────────────────▼────────────────────────────┐
│ 2. TENANT RUNTIME (one stack per customer)               │
│    "The customer's website + admin + MCP server"         │
│    Hosts (per tenant):                                   │
│    - <slug>.platform.realreal.cc / <byo-domain>          │
│      → tenant Vercel project (apps/web)                  │
│    - api-<...>.up.railway.app                            │
│      → tenant Railway service api (apps/api)             │
│    - mcp-<...>.up.railway.app                            │
│      → tenant Railway service mcp (apps/mcp)             │
│    - Supabase project (tenant-scoped)                    │
│    - Resend sending domain (per-tenant DKIM)             │
└────────────────────────────┬────────────────────────────┘
                             │ MCP protocol (HTTP+SSE) with bearer token
┌────────────────────────────▼────────────────────────────┐
│ 3. CUSTOMER AGENT (customer-owned)                       │
│    Customer's own Claude / Cursor / etc.                 │
│    Connects to its tenant's MCP server, runs tool calls. │
│    Outside our hosting / billing.                        │
└─────────────────────────────────────────────────────────┘
```

### Boundary rules (invariants)

| Rule | Why |
|---|---|
| Control plane never holds tenant business data (orders, products, users) | Tenant data lives only in its own Supabase; no aggregation table can leak across tenants |
| Tenant runtime is identity-blind — it knows itself only via env vars, not via a "tenant_id" column | Each tenant's code path is identical to a single-tenant app; impossible to accidentally read another tenant |
| Customer agent's privileges ≤ that tenant's admin role; never platform-level | Agent cannot escalate, list other tenants, or touch the control plane |

### Code repository layout (target end-of-sprint)

```
G/  (monorepo)
├── apps/
│   ├── web/             ← (existing) tenant runtime frontend
│   ├── api/             ← (existing) tenant runtime backend
│   ├── control/         ← NEW: Next.js dashboard at platform.realreal.cc
│   ├── workers/         ← NEW: Stripe webhook + provisioning workers (Railway long-running)
│   └── mcp/             ← NEW: MCP server (one Railway service per tenant)
├── packages/
│   ├── db/              ← (existing) tenant DB schema; new migrations 0015+
│   ├── control-db/      ← NEW: control-plane Supabase schema + helpers
│   ├── modules/         ← NEW: module registry, isEnabled() helper, gating middleware
│   └── theme/           ← NEW: brand schema (zod), default values
└── infrastructure/
    ├── provisioning/    ← NEW: typed wrappers around Vercel / Railway / Supabase / Resend / Cloudflare APIs
    └── deploy/          ← NEW: GitHub Actions workflows (canary, fan-out)
```

---

## 4. Control plane

### Hosting

| Component | Where |
|---|---|
| Dashboard | Vercel project `platform-control`, custom domain `platform.realreal.cc` |
| Workers | Railway project `platform-workers` |
| Database | Supabase project `platform-control` |
| Stripe | dashboard.stripe.com (live + test modes) |
| DNS | Cloudflare API (zone for platform.realreal.cc) |

The control plane runs on infrastructure owned by the platform itself, separate from any tenant.

### Control DB schema (`packages/control-db/migrations/`)

```sql
-- Platform-level user accounts (you, your staff, paying customers as billing entities)
create table platform_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  stripe_customer_id text unique,
  created_at timestamptz default now()
);

-- Tenant master record
create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                  -- 'realreal' → realreal.platform.realreal.cc
  custom_domain text unique,                  -- 'realreal.cc' (BYO; nullable)
  custom_domain_verified_at timestamptz,
  status text not null check (status in (
    'pending_payment', 'provisioning', 'active', 'suspended', 'canceled', 'failed'
  )),
  owner_user_id uuid references platform_users(id) not null,
  plan text check (plan in ('starter', 'standard', 'pro')),
  deploy_pin_commit text,                     -- v1 reserved, not read; future per-tenant version pin
  created_at timestamptz default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text
);

-- Tenant infrastructure IDs (sensitive — service-role read only, encrypted columns)
create table tenant_infrastructure (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  vercel_project_id text not null,
  vercel_deployment_url text,
  railway_project_id text not null,
  railway_api_service_id text not null,
  railway_api_url text,
  railway_mcp_service_id text not null,
  railway_mcp_url text,
  supabase_project_ref text not null,
  supabase_url text not null,
  supabase_anon_key text not null,
  supabase_service_role_key_encrypted bytea not null,    -- aes-256-gcm with PLATFORM_KEK
  resend_domain_id text,
  resend_dkim_verified_at timestamptz,
  cloudflare_zone_id text,
  mcp_token_hash text,                        -- bcrypt(mcp_access_token)
  created_at timestamptz default now()
);

-- Module enablement snapshots (real source of truth is in tenant DB, this is for observation)
create table tenant_modules (
  tenant_id uuid references tenants(id) on delete cascade,
  module text not null,
  enabled boolean default false,
  config jsonb default '{}'::jsonb,
  enabled_at timestamptz,
  primary key (tenant_id, module)
);

-- Provisioning job queue
create table provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  step text not null,
  status text not null check (status in ('queued', 'running', 'success', 'failed')),
  attempt int default 0,
  last_error text,
  payload jsonb,
  result jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now()
);
create index on provisioning_jobs (tenant_id, created_at);
create index on provisioning_jobs (status) where status in ('queued', 'failed');

-- Cross-tenant audit log
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  actor_type text not null check (actor_type in ('platform_admin', 'customer_agent', 'system', 'customer_user')),
  actor_id text,
  action text not null,
  resource text,
  payload jsonb,
  created_at timestamptz default now()
);
create index on audit_log (tenant_id, created_at desc);
create index on audit_log (actor_type, created_at desc);

-- Tenant health timeline
create table tenant_health_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id),
  checked_at timestamptz default now(),
  vercel_ok boolean,
  api_ok boolean,
  mcp_ok boolean,
  supabase_ok boolean,
  details jsonb
);
create index on tenant_health_log (tenant_id, checked_at desc);

-- Stripe state mirror
create table billing_subscriptions (
  id text primary key,
  tenant_id uuid references tenants(id) on delete set null,
  status text,
  plan text,
  current_period_end timestamptz,
  raw jsonb,
  updated_at timestamptz default now()
);

-- Stripe webhook idempotency
create table stripe_webhook_events (
  event_id text primary key,
  type text,
  payload jsonb,
  processed_at timestamptz default now()
);
```

### Encryption of `service_role_key`

A 32-byte master key (`PLATFORM_KEK`) lives in Railway env (workers + control). On write, `tenant_infrastructure.supabase_service_role_key` is encrypted via `aes-256-gcm` and stored as `bytea`. Decryption is gated by application code; raw bytes in the DB are useless without the master key.

KMS (AWS / GCP) is **not** used in v1 — `PLATFORM_KEK` rotation is a manual procedure documented in a runbook.

### `apps/control` dashboard pages

```
/                              Total tenants overview
/tenants                       List with filter (status), search by slug
/tenants/[id]                  Single tenant detail (health, modules, infra, recent audit)
/tenants/[id]/provision        Manually retry/inspect provisioning steps
/tenants/[id]/suspend          Freeze the tenant
/tenants/[id]/audit            Tenant-scoped audit log
/jobs                          Platform-wide provisioning_jobs queue
/audit                         Platform-wide audit log
/billing                       Stripe subscription status
```

Login is restricted to platform_users (`armand7951@gmail.com` and any staff added later).

### `apps/workers`

A long-running Node process on Railway with:

- **HTTP receiver**: Stripe webhook endpoint
- **Job runner**: poll `provisioning_jobs where status='queued'`, lock, run handler, update status
- **Cron**:
  - 5-min: tenant health checks
  - hourly: Resend domain DKIM verification poll
  - daily: Stripe subscription state reconciliation
  - daily: tenant_health_log retention prune (>90 days)

---

## 5. Tenant data model

### Invariant: identical schema across all tenants

Every tenant Supabase has the **same schema** regardless of which modules are enabled. Module toggles are runtime flags only. Trade-off accepted: a few empty tables per tenant DB if their modules are off, in exchange for zero runtime DDL.

### Schema additions in this sprint

Continuation of the existing `packages/db/migrations/` numbering (current head is `0014_storage_rls.sql`):

```
0015_schema_migrations.sql       -- track applied migrations per tenant DB (idempotency for fan-out)
0016_courses_schema.sql          -- courses, course_lessons, course_enrollments, lesson_progress
0017_crowdfund_schema.sql        -- crowdfund_projects, crowdfund_tiers, crowdfund_pledges, crowdfund_updates
0018_booking_schema.sql          -- booking_services, booking_slots, bookings
0019_config_history.sql          -- config_history (tracks site_contents changes)
0020_brand_seed.sql              -- seed default site_contents.brand + site_contents.module_config
```

### `site_contents` keys (the tenant's "config bag")

Existing (already seeded in 0012 and others): `email_*` templates, `homepage_hero`, `homepage_banner`, `faq_items`, `about_page`, `seo_defaults`, `footer_social`, `testimonials`, `payment_config`, `review_carousel`.

Added by this sprint:

```jsonc
// site_contents.brand
{
  "name": "Mybrand",
  "tagline": "...",
  "logo_url": "/storage/v1/object/public/branding/logo.png",
  "favicon_url": "/storage/v1/object/public/branding/favicon.ico",
  "colors": {
    "primary": "#4a7c59",
    "primary_foreground": "#ffffff",
    "accent": "#e8b923",
    "background": "#fafafa",
    "foreground": "#2d3436"
  },
  "font_family": "geist"   // whitelist: geist | inter | noto-sans-tc | lxgw-wenkai
}

// site_contents.module_config
{
  "subscriptions": true,
  "membership_tiers": true,
  "campaigns": true,
  "product_reviews": false,
  "cms_posts": true,
  "site_notice": true,
  "member_only_products": false,
  "courses": false,
  "crowdfunding": false,
  "bookings": false
}
```

### Storage buckets per tenant

| Bucket | Public | Purpose |
|---|---|---|
| `product-images` | yes | product photos (existing) |
| `branding` | yes | logo, favicon |
| `posts-media` | yes | CMS attachments |
| `course-content` | **private** | course videos / PDFs (signed URLs) |

### Per-tenant Supabase Auth config

- Site URL: `https://<custom_domain>` (BYO) or `https://<slug>.platform.realreal.cc`
- Redirect URLs: `{site_url}/auth/callback` + `https://*.vercel.app/auth/callback` (preview)
- Email confirmations: ON
- Auth email branding: tenant brand name applied via Auth admin API

### Seed data per tenant (run during provisioning)

```
✓ subscription_plans  → 3 default plans (monthly / quarterly / yearly)
✓ membership_tiers    → 3 default tiers (initial / familiar / committed)
✓ campaigns           → 12 inactive starter templates
✓ site_contents       → brand, module_config, hero/banner/about/faq/seo defaults, 12 email templates, payment_config (empty)
✓ categories          → 1 root "Uncategorized" (avoids FK violation when no categories yet)
✗ products, orders, users, posts, courses, crowdfund, bookings  → empty
```

### Module gating

A single helper enforces the module boundary in four places:

```
                    [tenant DB] site_contents.module_config
                              │
        ┌──────────┬──────────┼──────────┬──────────┐
        ▼          ▼          ▼          ▼          ▼
   ① backend     ② backend    ③ frontend ④ frontend ⑤ MCP
   route        worker       page       nav        tool
   middleware   skip         notFound   hide       filter
   (404)        (no-op)
```

```typescript
// packages/modules/registry.ts
export const MODULES = {
  subscriptions: {
    routes_to_gate: ['/subscriptions', '/admin/subscriptions'],
    workers_to_skip: ['subscription-billing'],
    nav_items: ['admin/subscriptions', 'subscribe'],
    mcp_tools: ['create_subscription', 'list_subscriptions', 'cancel_subscription', ...],
    required_modules: ['payments'],
  },
  courses: {
    routes_to_gate: ['/courses', '/admin/courses'],
    workers_to_skip: [],
    nav_items: ['courses'],
    mcp_tools: ['list_courses', 'create_course', 'publish_lesson'],
    required_modules: [],
  },
  // ... other modules
} as const;

// packages/modules/check.ts
export async function isEnabled(supabase: SupabaseClient, module: ModuleKey): Promise<boolean>
```

Disabling a module never deletes data; data persists in case of re-enable.

---

## 6. Provisioning flow

### Trigger

```
Customer signs up at platform.realreal.cc/buy
  → Stripe Checkout session
  → Stripe webhook checkout.session.completed → POST /webhooks/stripe (apps/workers)
  → Insert stripe_webhook_events (idempotency)
  → Insert tenants (status='pending_payment')
  → Enqueue provisioning_jobs for steps 1..8
  → Return 200 to Stripe
```

### Eight steps

| # | Step | Approx duration | Failure handling |
|---|---|---|---|
| 1 | `validate` | 10s | slug uniqueness, BYO domain format, plan-to-modules mapping |
| 2 | `supabase_setup` | 60–90s | create project, poll until ACTIVE_HEALTHY, fetch keys, run all migrations, seed initial data, configure Auth, create storage buckets |
| 3 | `resend_setup` | 20s | add sending domain in Resend, return SPF/DKIM/DMARC TXT records. BYO tenants get a dedicated `mail.<custom-domain>` sending domain (own DKIM). Platform-subdomain tenants share `mail.platform.realreal.cc`, which is verified once at platform setup time and reused thereafter (`From: <Brand Name> <noreply@mail.platform.realreal.cc>`). |
| 4 | `cloudflare_dns` | 10s + propagation | for platform subdomain: write CNAME `*.platform.realreal.cc` → Vercel; for BYO: include records in welcome email |
| 5 | `vercel_setup` | 60s | create Vercel project linked to G repo `production` branch, root `apps/web`, framework Next.js, set env vars (placeholder for Railway URL), trigger deploy, poll READY |
| 6 | `railway_setup` | 3–5 min | create Railway project, two services (api + mcp), set env vars, deploy each, poll healthchecks |
| 7 | `domain_finalize` | 30s + SSL ~30s | update Vercel env with real Railway URLs, redeploy, add custom domain to Vercel + Railway, wait for SSL |
| 8 | `tenant_finalize` | 10s | generate MCP token (bcrypt hash to DB, plaintext to email), create admin user via Auth Admin API, send welcome email, set tenants.status='active', emit Slack notification |

**Total happy-path time: 5–8 minutes for platform subdomain. BYO domain extends until customer sets DNS (typically 1–24 hours).**

### Step handler interface

```typescript
export interface StepHandler {
  step: ProvisioningStep
  isComplete(ctx: TenantContext): Promise<boolean>   // pre-check; skip if already done
  run(ctx: TenantContext): Promise<void>             // must be idempotent
}
```

### Idempotency

Every step does an `isComplete` pre-check (probe Vercel/Railway/Supabase by name or by stored ID). If the resource exists, the step skips creation and only finishes the remaining sub-tasks. Crash-restart of the worker mid-flight resumes cleanly.

### Retry

- Attempt 1 fails → wait 30s, requeue
- Attempt 2 fails → wait 2 min, requeue
- Attempt 3 fails → mark `failed`, alert platform admin via Slack + email

### Rollback

Not automatic. A failed provisioning leaves partially-created resources in place; the platform admin diagnoses via `/jobs` and either:

- clicks "Retry from this step" after fixing the underlying issue, or
- clicks "Destroy" on the tenant to tear down all resources and let the customer retry.

### v1 simplifications (deferred to v1.5)

- BYO custom domain has a manual confirmation gate after customer DNS is set (admin clicks "Mark domain configured" in dashboard).
- Resend DKIM verification runs hourly in the background; if not verified within 24h, fall back to `onboarding@resend.dev` and notify both customer and platform admin.

---

## 7. Deployment & update strategy

### Branch model

```
main          ← daily development; CI runs lint + test, no deploys
production    ← deploy target; PRs from main are reviewed and merged here to deploy
```

### Per-tenant Git connection

At provisioning, each tenant's Vercel project + Railway services are linked to G repo, watching the `production` branch. Push to `production` triggers per-tenant builds.

### Canary tenant

A platform-owned tenant `staging-canary` (`canary.platform.realreal.cc`) is created on day 1. It has all modules enabled and synthetic test data. It is **deployed first** before any real tenant.

### `deploy-all-tenants.yml` (GitHub Actions)

```yaml
name: deploy-production-fanout
on:
  push:
    branches: [production]

jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - trigger Vercel + Railway builds for tenant canary
      - wait for builds READY
      - smoke test:
          GET https://canary.platform.realreal.cc/                  # 200
          GET https://api-canary.up.railway.app/health              # 200
          GET https://mcp-canary.up.railway.app/healthz             # 200
          GET .../products    expect length === 10                  # synthetic data check

  migrations:
    needs: canary
    steps:
      - node scripts/fanout-migrations.ts
      # for each active tenant:
      #   diff packages/db/migrations/ vs tenant's schema_migrations table
      #   apply missing migrations idempotently via Supabase Mgmt API SQL endpoint
      # any failure aborts subsequent fan-out

  promote:
    needs: [canary, migrations]
    environment: production-fanout    # GitHub Environments → manual approval gate
    steps:
      - query control DB for tenants where status='active'
      - for each, trigger Vercel + Railway builds
      - log per-tenant success/failure to audit_log; do not abort siblings on partial failure

  monitor:
    needs: promote
    steps:
      - cron-style 1-hour watch: poll /health for all tenants every 5 minutes
      - on 3 consecutive failures for a tenant: email platform admin + auto-rollback that tenant via Vercel rollback API
```

### Rollback

| Failure type | Recovery |
|---|---|
| Vercel deploy bug | Click "Rollback" in control plane → calls Vercel rollback API |
| Railway deploy bug | Same, Railway redeploy previous build |
| DB migration bug | Ship a forward-fix migration; never write a destructive `down` migration |
| Platform-wide breakage | Revert PR on production, re-run fan-out workflow |

### Environment variable fan-out

Platform-wide env vars listed in `packages/config/required-envs.ts`. When that list changes, a separate fan-out step pushes the env var (with default or platform-set value) to every tenant's Vercel and Railway via their APIs. Tenant-managed config (e.g., payment_config) is **not** an env var; it lives in tenant Supabase and isn't fanned out.

### Deferred to later sprints

- Per-tenant version pinning (schema column `tenants.deploy_pin_commit` exists but is not read in v1).
- Phased rollout (10% → 50% → 100%). v1 is canary-then-all.

---

## 8. MCP server

### Per-tenant deployment

Each tenant Railway project hosts two services sharing the same env (Supabase URL, service role key, internal API secret):

- `api` (apps/api)
- `mcp` (apps/mcp)

### Stack

- Node + `@modelcontextprotocol/sdk`
- HTTP + SSE transport (compatible with Claude Desktop, Claude Code, Cursor)

### Authentication

Bearer token model. Each tenant has one long-lived `mcp_access_token` issued at provisioning step 8. Plaintext is sent to the customer via welcome email exactly once; only its bcrypt hash is stored in `tenant_infrastructure.mcp_token_hash`. Token rotation in v1 is performed by the platform admin via the control plane dashboard.

### Tool catalog (v1)

12 namespaces, ~50 tools. Each tool has a zod input schema and a structured JSON output. Tools are filtered by `site_contents.module_config` at request time (refresh every 60s).

```
brand:        get_site_info, update_brand, update_homepage_hero, update_homepage_banner,
              update_about_page, update_faq_items, update_seo_defaults, update_footer_social,
              update_site_notice
modules:      list_modules, enable_module, disable_module, get_module_config, update_module_config
products:     list_products, get_product, create_product, update_product, delete_product,
              list_variants, create_variant, update_variant_price, update_variant_stock,
              upload_product_image
categories:   list_categories, create_category, update_category, delete_category
orders:       list_orders, get_order, update_order_status, refund_order, resend_order_confirmation
campaigns:    list_campaigns, create_campaign, enable_campaign, disable_campaign,
              delete_campaign, list_campaign_templates, apply_campaign_template
              [requires module=campaigns]
coupons:      list_coupons, create_coupon, delete_coupon
              [requires module=campaigns]
posts:        list_posts, create_post, update_post, publish_post, delete_post
              [requires module=cms_posts]
subscriptions: list_plans, create_plan, update_plan, list_active_subscriptions, cancel_subscription
              [requires module=subscriptions]
members:      list_users, get_user, assign_membership_tier, list_membership_tiers, create_membership_tier
reviews:      list_reviews, moderate_review
              [requires module=product_reviews]
payments:     get_payment_config (masked values), update_payment_config
```

Tools for course / crowdfund / booking are added in their respective sprints.

### Tool implementation strategy

- Most tools are thin wrappers over the existing `apps/api` admin REST endpoints.
- A few read-only tools query Supabase directly (e.g., `get_site_info` reads `site_contents`).
- Adding a tool ≈ adding a function in `apps/mcp/src/tools/<namespace>.ts`.

### How the MCP server acts on the tenant's behalf

A virtual admin user `mcp@<slug>.local` is created at provisioning time and assigned `role='admin'` in tenant DB. The MCP server signs in with that user's credentials at startup, holds a refreshing JWT, and passes it as `Authorization: Bearer ...` when calling `apps/api`. This way:

- The existing `requireAuth + requireAdmin` middleware works unchanged.
- Tenant-side audit log shows actions clearly attributed to `mcp@<slug>.local`.
- Customer can revoke MCP access by disabling that user (when self-service rotation lands).

### Audit emission

Every successful tool call writes:

1. To the tenant DB `config_history` (visible to the customer).
2. To the control plane `POST /internal/audit` (HMAC-signed via `INTERNAL_API_SECRET`), keyed by `tenant_id` + `actor_type='customer_agent'` + `actor_id=<token_id>`.

### Rate limit (per tenant)

- 1000 tool calls / hour
- 50 tool calls / minute (loop guard)

Excess returns HTTP 429; logged to audit.

### Versioning

v1 has no formal tool versioning. Breaking changes ship in `production` and all tenants pick them up on the next deploy. v1.5 introduces a `@since` tag in tool descriptions and a deprecation flow.

---

## 9. Error handling & observability

### Layer responsibilities

| Layer | Detect | Alert | Resolution path |
|---|---|---|---|
| Control plane | provisioning_jobs failures, Stripe webhook errors, Mgmt API quota | jobs table + cron | Slack #platform-ops → platform admin |
| Tenant runtime | crashes, healthcheck failures | Railway logs + active healthcheck cron | Slack ping → admin investigates → notifies customer if >5 min |
| Customer agent | tool failures, token issues, rate limits | MCP audit emission | Customer-side first; platform admin escalates if systemic |

### Logging

V1 uses each platform's native log viewer (Vercel logs, Railway logs, Supabase logs). Cross-tenant correlation is manual (open multiple tabs). v1.5 forwards all to a single Logflare/BetterStack instance and integrates a log viewer into `apps/control`.

### Active healthcheck

Workers run a 5-minute cron over all `status='active'` tenants:

```typescript
for (const tenant of activeTenants) {
  const checks = await Promise.allSettled([
    fetch(`${tenant.vercel_url}/`),
    fetch(`${tenant.railway_api_url}/health`),
    fetch(`${tenant.railway_mcp_url}/healthz`),
    supabaseHealth(tenant.supabase_ref),
  ]);
  await recordHealth(tenant.id, checks);
  if (consecutiveFailures(tenant.id) >= 3) await alertOps(tenant.id, checks);
}
```

Records persist in `tenant_health_log` for the dashboard timeline.

### Alert severity ladder

```
🟢 INFO   audit_log only
🟡 WARN   Slack #platform-ops          (provisioning failed once, single healthcheck failure)
🔴 ALERT  Slack + email                (3-streak failure, Stripe webhook 5x failure, provisioning stuck >30min)
🚨 PAGE   phone/SMS                    (v1 deferred)
```

### Backups

| Data | Backup | Restore |
|---|---|---|
| Tenant Supabase | Supabase Pro PITR (7 days) | dashboard one-click |
| Tenant Storage | none in v1 | accept risk; v1.5 cron syncs to platform-owned R2/S3 |
| Control plane Supabase | Supabase Pro PITR | same |

### Tenant cancellation flow

1. Stripe `customer.subscription.deleted` webhook → control plane.
2. `tenants.status = 'canceled'`, `suspended_at = now()`.
3. Vercel deployment frozen (returns 503 maintenance page).
4. Railway services suspended (data preserved).
5. Supabase project preserved.
6. After 30 days, cron runs irreversible teardown (deletes Vercel/Railway/Supabase projects).
7. 7 days before teardown, customer is emailed a tenant data export link (DB dump + Storage zip).

### KPIs visible on the dashboard home

- `tenant_count_active`
- `provisioning_p95_seconds` (last 30 days)
- `tenant_5xx_count` per tenant per hour
- `mcp_tool_call_count` per tenant per hour
- `mcp_tool_call_error_rate`
- `health_check_failure_streak` per tenant

### Runbooks (must exist before GA)

- `tenant-down.md`
- `stripe-webhook-pileup.md`
- `supabase-quota-hit.md`
- `accidental-data-delete.md`
- `mcp-token-leak.md`
- `code-deploy-broke-everyone.md`

---

## 10. Testing strategy

### Layer pyramid

```
                       ┌─────┐
                       │ E2E │   5 critical-path tests on canary, before production fan-out
                       └─────┘
                  ┌─────────────────┐
                  │  Integration    │   ~100 tests (apps/api routes, apps/mcp tools)
                  └─────────────────┘
            ┌───────────────────────────┐
            │           Unit            │   ~300 tests (packages/*, helpers, validators)
            └───────────────────────────┘
```

Plus four multi-tenant–specific suites:

### Provisioning tests

- **L1 (CI per PR)** — pure unit, mock all Mgmt APIs. Tests step handler logic, idempotency pre-checks, retry conditions, payload shape.
- **L2 (CI per PR)** — integration with recorded API responses (fixtures). Verifies the 8-step chain ordering, error propagation, and `provisioning_jobs` state transitions. Completes in ~3 minutes.
- **L3 (manual, pre-release)** — live end-to-end. Spins up a throwaway tenant, runs the entire pipeline, verifies the live site, then tears down. Burns ~NT$50 of API costs and ~30 minutes; mandatory in `release-checklist.md`.

### Module gating tests

`apps/api/src/__tests__/modules.test.ts` parameterizes over each module:

```typescript
describe.each([
  ['subscriptions', '/admin/subscriptions', 'GET'],
  ['campaigns', '/admin/campaigns', 'POST'],
  ['cms_posts', '/admin/posts', 'GET'],
  ['courses', '/admin/courses', 'GET'],
  // ... all toggleable modules
])('module %s gating', (module, path, method) => {
  it(`returns 404 when disabled`, async () => { ... });
  it(`returns 200 when enabled`, async () => { ... });
});
```

Adding a new toggleable module = adding a row to that table.

### Multi-tenant isolation tests

`apps/api/src/__tests__/isolation.test.ts` spins up two test tenants on a shared test Supabase (different schemas). Asserts:

- Tenant A admin cannot read tenant B products via apps/api.
- MCP token issued for tenant A is rejected by tenant B's MCP server.
- Tenant A audit log does not contain tenant B actions.

### Migration fan-out tests

`apps/workers/src/__tests__/fanout-migrations.test.ts`:

- Skips already-applied migrations.
- Aborts on migration error and does not corrupt `schema_migrations`.

### E2E (Playwright) — 5 paths on canary

1. Visitor browse → cart → checkout (test card) → order confirmation email.
2. Sign up → confirm email → log in → my orders.
3. Admin login → change brand color → public page reflects within seconds.
4. Admin enable courses module → /courses route accessible (was 404).
5. Customer agent connects MCP → runs `update_homepage_hero` → public page shows the new copy.

Total E2E runtime ≤ 5 min. Failure blocks the production fan-out.

### Test environment secrets

GitHub Actions repo secrets:

- `TEST_SUPABASE_PAT`, `TEST_VERCEL_TOKEN`, `TEST_RAILWAY_TOKEN`, `TEST_RESEND_API_KEY`, `TEST_STRIPE_SECRET_KEY`
- `CANARY_MCP_TOKEN`, `CANARY_ADMIN_EMAIL`, `CANARY_ADMIN_PASSWORD`

### Excluded from v1 (YAGNI)

- Performance / load tests
- Visual regression (Percy / Chromatic)
- Cross-browser matrix
- Automated a11y testing
- Mutation testing
- 100% coverage targeting (80% acceptable; long-tail by manual QA)

---

## 11. Migration plan: realreal → tenant #1

### Current state (2026-05-10)

- realreal infra live: Tokyo Supabase `ozwftlkgqmewtadypsfi`, Railway `api-production-ed3c.up.railway.app`, Vercel `agent-web-xi.vercel.app`.
- Production data already migrated: 53 users, 30 products, 73 orders, 53 user_profiles, full site_contents seeded.
- Admin `armand7951@gmail.com` (password `000000` — must rotate before GA).
- DNS: `realreal.cc` still on legacy infra, cutover scheduled 2026-05-17.
- PR #1 (Resend), PR #2 (admin-editable payment config) already merged.

### Target state

- `tenants` row #1: `slug='realreal'`, `custom_domain='realreal.cc'`, `status='active'`.
- `tenant_infrastructure` reuses existing Vercel + Railway + Supabase IDs (no rebuild).
- A new `mcp` Railway service is added under the existing realreal Railway project.
- Existing realreal Vercel + Railway services switch their watched branch from `main` to `production`.
- New migrations 0015–0020 applied to realreal Supabase (0019 first to test schema_migrations idempotency).

### Implementation phases (high-level — concrete tasks emerge in writing-plans)

```
Phase A — Control plane infra              (~3 weeks)
  A1  create platform-control Supabase
  A2  scaffold apps/control (Next.js dashboard)
  A3  scaffold apps/workers (webhook + provisioning runner)
  A4  deploy: apps/control to platform-owned Vercel; apps/workers to platform-owned Railway
  A5  write control DB schema + schema_migrations bootstrap
  A6  write packages/db/migrations/0015..0020
  A7  apply 0015..0020 to realreal Supabase first (proves backward compat)

Phase B — Template extraction (F refactor) (~3 weeks)
  B1  packages/modules/registry.ts + isEnabled() + gating middleware
  B2  packages/theme/brand.ts schema + zod validation
  B3  replace hardcoded "誠真生活" / "RealReal" → site_contents.brand.name
  B4  logo, favicon, colors → CSS custom properties from brand
  B5  hero/banner copy → site_contents.homepage_*
  B6  apps/api gating middleware
  B7  apps/web gating wrapper (notFound when module disabled)
  B8  seed site_contents.brand + .module_config in realreal (modules currently used → on)
  B9  deploy to realreal Vercel/Railway, run full vitest suite + 5 E2E paths

Phase C — Register realreal in control plane (~1 week)
  C1  manually INSERT realreal tenants + tenant_infrastructure rows (existing IDs)
  C2  run import-existing-tenant script:
        - create mcp@realreal.local virtual admin
        - generate MCP token, hash to DB, email plaintext to platform admin
  C3  add mcp Railway service to existing realreal Railway project, deploy apps/mcp
  C4  add platform subdomain + realreal.cc to Auth Site URL allow-list
  C5  smoke-test MCP from Claude Code: update_brand → revert
  C6  switch realreal Vercel + Railway services from `main` branch to `production` branch (so future fan-out reaches them); first push to `production` tagged as the realreal go-live commit
  C7  realreal appears on platform dashboard with green health

Phase D — Provisioning pipeline                (~3 weeks)
  D1  implement 8 step handlers
  D2  hook Stripe test webhook
  D3  spin up throwaway tenant `pioneer-test` via the pipeline
  D4  fix race conditions / timeouts / partial failures discovered
  D5  3 consecutive successful live provisions
  D6  create staging-canary tenant, wire production-branch auto-deploy

Phase E — GA readiness                          (~2 weeks)
  E1  control plane dashboard polish
  E2  6 runbooks
  E3  customer welcome email + MCP usage docs
  E4  realreal.cc DNS cutover (per existing 2026-05-17 plan, unaffected)
  E5  Stripe live mode, landing page open, first paying tenant onboarded
```

**Total estimated duration: ~12 weeks.**

### Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| F refactor inadvertently breaks existing realreal behavior | high | (1) every site_contents key has a code-side fallback to the current hardcoded string; (2) Phase B9 reruns the existing 184 vitest tests + 5 E2E paths; (3) Vercel preview deployment validates before production merge |
| Migration fan-out fails on realreal | medium | (1) run migrations on realreal first in A7; (2) all migrations are idempotent (`IF NOT EXISTS` etc.); (3) dry-run on a throwaway Supabase first |
| Existing realreal Vercel/Railway lacks settings expected by control plane | medium | (1) audit before C1; (2) `import-existing-tenant.ts` reconciles settings |
| `armand7951@gmail.com` password `000000` is brute-forced | high (already known) | rotate to 32-byte random in Phase C; email new credentials to admin |
| 2026-05-17 DNS cutover collides with this spec | medium | DNS cutover proceeds as planned and is independent of this spec; the realreal infra it cuts over to is the same one we're folding in as tenant #1 — only the registry/identity changes, not the runtime |
| Adding mcp Railway service raises Railway bill | certain (~+$5/mo) | acceptable; future tenants pay for their own |

### Validation criteria for "migration complete"

- [ ] `https://realreal.cc` 200, parity with pre-migration behavior (front-end visual + functional).
- [ ] `https://platform.realreal.cc` 200, dashboard shows tenant #1 = realreal.
- [ ] Control DB `tenants` shows `realreal` with `status='active'`.
- [ ] `tenant_health_log` shows 24h continuous green for realreal.
- [ ] Claude Code → MCP `update_brand --primary_color=#ff0000` → public page goes red → revert.
- [ ] Stripe test mode end-to-end provisioning of a throwaway tenant succeeds in 5–8 min and passes smoke tests.
- [ ] One internal test tenant (not realreal) is live in Stripe live mode and stable for 7 days.
- [ ] Six runbooks present in `docs/runbooks/`.

---

## 12. Open questions / unresolved

1. **Slack workspace and webhook URL** for `#platform-ops` alerts — to be set up before Phase A4.
2. **Stripe product/price IDs** for v1 single plan — to be created before Phase D2.
3. **Resend account quota** for per-tenant DKIM domains — current Resend plan supports a finite number; verify before D2.
4. **`PLATFORM_KEK` rotation cadence** — proposed 12 months in v1 runbook; revisit after first audit.
5. **Customer onboarding self-service docs** — rough draft in Phase E3; full polish in v1.5.

## 13. Out of scope (explicit)

- Drag-and-drop visual page builder
- Course / crowdfund / booking module **implementations** (their tables exist but their frontend, admin UI, and MCP tools are future specs)
- Customer self-service MCP token rotation UI
- Multi-admin per tenant
- Stripe plan upgrade/downgrade
- Fully unattended BYO-domain provisioning (v1 has a manual confirmation gate)
- Cross-platform log aggregation
- Per-tenant version pinning behavior (schema reserved)
- Performance benchmarks
- A11y automation
- KMS-backed key management
