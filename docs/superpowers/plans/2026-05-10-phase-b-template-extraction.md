# Phase B — Template Extraction (F Refactor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un-hardcode the realreal storefront so the same `apps/web` + `apps/api` codebase can serve any tenant by reading brand identity, copy, and module enablement from `site_contents.brand` and `site_contents.module_config`. After Phase B, realreal still looks and behaves identically to today, but every brand string, color, logo, hero/banner, and module-gated route is sourced from tenant DB with hardcoded fallbacks.

**Architecture:** Two new packages — `packages/theme` (zod brand schema + defaults + a `getBrand()` server helper) and `packages/modules` (module registry + `isEnabled()` helper + Express middleware + Next.js page wrapper). Storefront layout, header, footer, metadata, and homepage hero/banner sections read from `site_contents.brand` / `site_contents.homepage_*` via a request-scoped server helper that falls back to compile-time constants identical to today's hardcoded values. Backend admin routes are wrapped with `requireModule(...)` middleware that returns 404 when the module is disabled. Frontend pages for gated modules use a `gateModule()` helper that calls `notFound()` when disabled. Every site_contents read has a fallback so a missing key cannot break the page.

**Tech Stack:** Next.js 16 (App Router), Express 5, TypeScript, Vitest, Tailwind v4 with CSS variables, Supabase JS client. Node 22+. Zod 3.

**Spec reference:** `docs/superpowers/specs/2026-05-10-multi-tenant-platform-foundation-design.md` §3 (architecture), §5 (tenant data model — `site_contents.brand`, `site_contents.module_config`), §11 Phase B (B1–B9), §11 risk table.

**Phase A dependencies (already merged):** migrations `0015_schema_migrations.sql`–`0020_brand_seed.sql` are applied to realreal Supabase. `site_contents` row `brand` and `module_config` exist with default values. `packages/control-db` exists but is not consumed by tenant runtime.

**Out of scope for this plan:** control plane changes (Phase A complete), tenant registration in control DB (Phase C), MCP server (Phase C), provisioning pipeline (Phase D), runbooks/GA polish (Phase E). New E2E (Playwright) suite is **not** introduced here — Phase B9 reruns the existing 29 vitest test files (~184 unit/integration assertions) and a manual smoke checklist; the full Playwright suite is built in Phase D6 alongside the canary tenant.

---

## File Structure

```
G/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/
│   │       │   ├── layout.tsx                          [MODIFY: PR-B3, PR-B4]
│   │       │   ├── globals.css                         [MODIFY: PR-B4]
│   │       │   ├── page.tsx                            [MODIFY: PR-B5]
│   │       │   ├── robots.ts                           [MODIFY: PR-B3]
│   │       │   ├── sitemap.ts                          [MODIFY: PR-B3]
│   │       │   ├── auth/
│   │       │   │   ├── login/page.tsx                  [MODIFY: PR-B3]
│   │       │   │   ├── login/layout.tsx                [MODIFY: PR-B3]
│   │       │   │   ├── register/page.tsx               [MODIFY: PR-B3]
│   │       │   │   ├── register/layout.tsx             [MODIFY: PR-B3]
│   │       │   │   ├── forgot-password/page.tsx       [MODIFY: PR-B3]
│   │       │   │   └── reset-password/page.tsx        [MODIFY: PR-B3]
│   │       │   ├── shop/page.tsx                       [MODIFY: PR-B3]
│   │       │   ├── shop/[slug]/page.tsx                [MODIFY: PR-B3]
│   │       │   ├── faq/page.tsx                        [MODIFY: PR-B3]
│   │       │   ├── contact/page.tsx                    [MODIFY: PR-B3]
│   │       │   ├── privacy/page.tsx                    [MODIFY: PR-B3]
│   │       │   ├── terms/page.tsx                      [MODIFY: PR-B3]
│   │       │   ├── subscribe/page.tsx                  [MODIFY: PR-B7]   (gate subscriptions module)
│   │       │   ├── blog/page.tsx                       [MODIFY: PR-B7]   (gate cms_posts)
│   │       │   ├── blog/[slug]/page.tsx                [MODIFY: PR-B7]
│   │       │   ├── membership/page.tsx                 [MODIFY: PR-B7]   (gate membership_tiers)
│   │       │   ├── courses/page.tsx                    [NEW: PR-B7]      (placeholder gated by courses module — empty state)
│   │       │   └── _gated/                             [NEW: PR-B7]
│   │       │       └── ModuleGate.tsx                  (server helper that calls notFound() if module disabled)
│   │       ├── components/
│   │       │   └── layout/
│   │       │       ├── Header.tsx                      [MODIFY: PR-B3, PR-B4, PR-B7]
│   │       │       ├── Footer.tsx                      [MODIFY: PR-B3, PR-B4]
│   │       │       └── StorefrontShell.tsx             [MODIFY: PR-B4]
│   │       └── lib/
│   │           ├── content.ts                          [MODIFY: PR-B2 — add getBrand(), getModuleConfig()]
│   │           ├── brand.ts                            [NEW: PR-B2 — re-exports + fallbacks]
│   │           └── __tests__/
│   │               └── brand.test.ts                   [NEW: PR-B2]
│   └── api/
│       └── src/
│           ├── app.ts                                  [MODIFY: PR-B6 — register requireModule on gated routers]
│           ├── middleware/
│           │   ├── module-gate.ts                      [NEW: PR-B6]
│           │   └── __tests__/
│           │       └── module-gate.test.ts             [NEW: PR-B6]
│           └── lib/
│               └── module-config.ts                    [NEW: PR-B6 — server-side cache + read]
├── packages/
│   ├── theme/                                          [NEW: PR-B2]
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── brand.ts                                (zod schema, types)
│   │   │   ├── defaults.ts                             (DEFAULT_BRAND constant — exact realreal values)
│   │   │   └── css.ts                                  (brandToCssVars())
│   │   └── __tests__/
│   │       ├── brand.test.ts
│   │       └── css.test.ts
│   ├── modules/                                        [NEW: PR-B1]
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── registry.ts                             (MODULES const, ModuleKey type)
│   │   │   ├── check.ts                                (isEnabled, getEnabledModules)
│   │   │   ├── express.ts                              (requireModule middleware factory)
│   │   │   └── next.ts                                 (gateModule() server helper)
│   │   └── __tests__/
│   │       ├── registry.test.ts
│   │       ├── check.test.ts
│   │       └── express.test.ts
│   └── db/migrations/
│       └── 0021_brand_realreal_seed.sql                [NEW: PR-B8 — backfill realreal-specific brand]
├── package.json                                        [MODIFY: PR-B1, PR-B2 — add new workspace packages]
├── turbo.json                                          [MODIFY: PR-B1, PR-B2 — pipeline tasks]
└── tsconfig.base.json                                  [MODIFY: PR-B1, PR-B2 — path aliases @repo/modules, @repo/theme]
```

---

## Spec → PR coverage map

| Spec §11 Phase B item | PR |
|---|---|
| B1 — `packages/modules/registry.ts` + `isEnabled()` + gating middleware | PR-B1 |
| B2 — `packages/theme/brand.ts` schema + zod | PR-B2 |
| B3 — replace hardcoded "誠真生活" / "RealReal" → `site_contents.brand.name` | PR-B3 |
| B4 — logo, favicon, colors → CSS custom properties from brand | PR-B4 |
| B5 — hero/banner copy → `site_contents.homepage_*` | PR-B5 |
| B6 — `apps/api` gating middleware | PR-B6 |
| B7 — `apps/web` gating wrapper (notFound when disabled) | PR-B7 |
| B8 — seed `site_contents.brand` + `.module_config` for realreal | PR-B8 |
| B9 — deploy to realreal Vercel/Railway, run full vitest + smoke tests | PR-B9 |

| Risk (§11) | Where addressed |
|---|---|
| F refactor inadvertently breaks existing realreal behavior (high) | Every read in PR-B2/B3/B4/B5 has a hardcoded fallback identical to current realreal value (literal in `packages/theme/src/defaults.ts` and per-page constants); PR-B9 reruns all 29 vitest test files; every PR includes a Vercel preview validation step before merge |
| Migration fan-out fails on realreal (medium) | PR-B8 migration is `on conflict (key) do update` and idempotent; verified against realreal Supabase before merge |
| Existing realreal Vercel/Railway lacks expected settings (medium) | PR-B9 explicitly validates `NEXT_PUBLIC_API_URL`, Supabase env, and that `/site-contents/brand` returns 200 from realreal API in production preview |

---

## Task 1 (PR-B1): `packages/modules` — registry + `isEnabled()` + Express + Next.js gates

**Goal:** Single source of truth for module enablement. Five places to gate (backend route, backend worker, frontend page, frontend nav, MCP tool) all consult one helper. No callers wired yet (B6/B7 do that); this PR ships the package + tests only.

**Files:**
- Create: `packages/modules/package.json`
- Create: `packages/modules/tsconfig.json`
- Create: `packages/modules/src/index.ts`
- Create: `packages/modules/src/registry.ts`
- Create: `packages/modules/src/check.ts`
- Create: `packages/modules/src/express.ts`
- Create: `packages/modules/src/next.ts`
- Create: `packages/modules/__tests__/registry.test.ts`
- Create: `packages/modules/__tests__/check.test.ts`
- Create: `packages/modules/__tests__/express.test.ts`
- Modify: `package.json` (workspaces glob already includes `packages/*`; verify)
- Modify: `tsconfig.base.json` (add path alias `@repo/modules` → `packages/modules/src/index.ts`)
- Modify: `turbo.json` (no change if `packages/*` is already covered by `build`/`test` — verify)

### Steps

- [ ] **Step 1.1: Failing test — registry shape**

Create `packages/modules/__tests__/registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { MODULES, MODULE_KEYS } from "../src/registry"

describe("MODULES registry", () => {
  it("exposes all 10 toggleable modules from spec §5", () => {
    expect(MODULE_KEYS.sort()).toEqual([
      "bookings",
      "campaigns",
      "cms_posts",
      "courses",
      "crowdfunding",
      "member_only_products",
      "membership_tiers",
      "product_reviews",
      "site_notice",
      "subscriptions",
    ])
  })

  it("every module declares at least routes_to_gate or nav_items", () => {
    for (const key of MODULE_KEYS) {
      const m = MODULES[key]
      expect(m.routes_to_gate.length + m.nav_items.length).toBeGreaterThan(0)
    }
  })

  it("subscriptions requires payments dependency", () => {
    expect(MODULES.subscriptions.required_modules).toContain("payments")
  })
})
```

Run `pnpm --filter @repo/modules test` → fails (package doesn't exist).

- [ ] **Step 1.2: Scaffold `packages/modules/package.json`**

```json
{
  "name": "@repo/modules",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0"
  },
  "peerDependencies": {
    "express": "^5.0.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "express": "^5.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 1.3: `packages/modules/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "composite": false },
  "include": ["src/**/*", "__tests__/**/*"]
}
```

- [ ] **Step 1.4: `packages/modules/src/registry.ts`**

```typescript
export const MODULES = {
  subscriptions: {
    routes_to_gate: ["/subscriptions", "/admin/subscriptions", "/subscription-plans"],
    workers_to_skip: ["subscription-billing"],
    nav_items: ["subscribe", "admin/subscriptions"],
    mcp_tools: ["list_plans", "create_plan", "update_plan", "list_active_subscriptions", "cancel_subscription"],
    required_modules: ["payments"] as string[],
  },
  membership_tiers: {
    routes_to_gate: ["/admin/tiers", "/membership"],
    workers_to_skip: [],
    nav_items: ["membership", "admin/tiers"],
    mcp_tools: ["list_membership_tiers", "create_membership_tier", "assign_membership_tier"],
    required_modules: [],
  },
  campaigns: {
    routes_to_gate: ["/admin/campaigns", "/admin/coupons"],
    workers_to_skip: [],
    nav_items: ["admin/campaigns", "admin/coupons"],
    mcp_tools: ["list_campaigns", "create_campaign", "enable_campaign", "disable_campaign", "delete_campaign", "list_campaign_templates", "apply_campaign_template", "list_coupons", "create_coupon", "delete_coupon"],
    required_modules: [],
  },
  product_reviews: {
    routes_to_gate: ["/admin/reviews"],
    workers_to_skip: [],
    nav_items: ["admin/reviews"],
    mcp_tools: ["list_reviews", "moderate_review"],
    required_modules: [],
  },
  cms_posts: {
    routes_to_gate: ["/admin/posts", "/admin/post-categories", "/admin/post-tags", "/posts"],
    workers_to_skip: [],
    nav_items: ["blog", "admin/posts"],
    mcp_tools: ["list_posts", "create_post", "update_post", "publish_post", "delete_post"],
    required_modules: [],
  },
  site_notice: {
    routes_to_gate: [],
    workers_to_skip: [],
    nav_items: [],
    mcp_tools: ["update_site_notice"],
    required_modules: [],
  },
  member_only_products: {
    routes_to_gate: [],
    workers_to_skip: [],
    nav_items: [],
    mcp_tools: [],
    required_modules: ["membership_tiers"],
  },
  courses: {
    routes_to_gate: ["/courses", "/admin/courses"],
    workers_to_skip: [],
    nav_items: ["courses", "admin/courses"],
    mcp_tools: ["list_courses", "create_course", "publish_lesson"],
    required_modules: [],
  },
  crowdfunding: {
    routes_to_gate: ["/crowdfund", "/admin/crowdfund"],
    workers_to_skip: [],
    nav_items: ["crowdfund", "admin/crowdfund"],
    mcp_tools: ["list_crowdfund_projects", "create_crowdfund_project"],
    required_modules: ["payments"],
  },
  bookings: {
    routes_to_gate: ["/bookings", "/admin/bookings"],
    workers_to_skip: [],
    nav_items: ["bookings", "admin/bookings"],
    mcp_tools: ["list_booking_services", "create_booking_service"],
    required_modules: [],
  },
} as const

export type ModuleKey = keyof typeof MODULES
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[]
```

- [ ] **Step 1.5: `packages/modules/src/check.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js"
import { MODULE_KEYS, type ModuleKey } from "./registry"

export type ModuleConfig = Partial<Record<ModuleKey, boolean>>

const DEFAULT_DISABLED: ModuleConfig = Object.fromEntries(
  MODULE_KEYS.map((k) => [k, false])
) as ModuleConfig

/**
 * Read site_contents.module_config. Falls back to all-disabled on any error.
 * Callers should cache (60s TTL recommended) at the call site; this fn is uncached.
 */
export async function getModuleConfig(supabase: SupabaseClient): Promise<ModuleConfig> {
  const { data, error } = await supabase
    .from("site_contents")
    .select("value")
    .eq("key", "module_config")
    .single()
  if (error || !data) return DEFAULT_DISABLED
  return { ...DEFAULT_DISABLED, ...(data.value as ModuleConfig) }
}

export async function isEnabled(supabase: SupabaseClient, module: ModuleKey): Promise<boolean> {
  const cfg = await getModuleConfig(supabase)
  return cfg[module] === true
}
```

- [ ] **Step 1.6: Failing test — `isEnabled` honors fallback**

Create `packages/modules/__tests__/check.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"
import { isEnabled, getModuleConfig } from "../src/check"

function fakeSupabase(value: unknown, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: value ? { value } : null, error }) }),
      }),
    }),
  } as never
}

describe("isEnabled", () => {
  it("returns true when module is on in DB", async () => {
    expect(await isEnabled(fakeSupabase({ courses: true }), "courses")).toBe(true)
  })
  it("returns false when key missing in DB row", async () => {
    expect(await isEnabled(fakeSupabase({}), "courses")).toBe(false)
  })
  it("returns false when DB errors", async () => {
    expect(await isEnabled(fakeSupabase(null, { code: "X" }), "subscriptions")).toBe(false)
  })
  it("getModuleConfig back-fills all keys with false", async () => {
    const cfg = await getModuleConfig(fakeSupabase({ subscriptions: true }))
    expect(cfg.subscriptions).toBe(true)
    expect(cfg.courses).toBe(false)
    expect(cfg.bookings).toBe(false)
  })
})
```

- [ ] **Step 1.7: `packages/modules/src/express.ts`**

```typescript
import type { Request, Response, NextFunction, RequestHandler } from "express"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isEnabled } from "./check"
import type { ModuleKey } from "./registry"

export interface ModuleGateOptions {
  supabase: SupabaseClient
  ttlMs?: number
}

/**
 * Returns Express middleware that 404s when the named module is disabled.
 * Caches the module_config read for `ttlMs` (default 60_000ms, per spec §5 "within 60 seconds").
 */
export function requireModule(module: ModuleKey, opts: ModuleGateOptions): RequestHandler {
  let cache: { at: number; enabled: boolean } | null = null
  const ttl = opts.ttlMs ?? 60_000
  return async (_req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    if (!cache || now - cache.at > ttl) {
      cache = { at: now, enabled: await isEnabled(opts.supabase, module) }
    }
    if (!cache.enabled) {
      res.status(404).json({ error: "Not found" })
      return
    }
    next()
  }
}
```

- [ ] **Step 1.8: Failing test — Express middleware**

Create `packages/modules/__tests__/express.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"
import express from "express"
import request from "supertest"
import { requireModule } from "../src/express"

function fake(value: Record<string, boolean>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: { value }, error: null }) }),
      }),
    }),
  } as never
}

describe("requireModule", () => {
  it("404s when module disabled", async () => {
    const app = express()
    app.get("/courses", requireModule("courses", { supabase: fake({ courses: false }) }), (_req, res) => res.json({ ok: true }))
    const res = await request(app).get("/courses")
    expect(res.status).toBe(404)
  })
  it("passes through when enabled", async () => {
    const app = express()
    app.get("/courses", requireModule("courses", { supabase: fake({ courses: true }) }), (_req, res) => res.json({ ok: true }))
    const res = await request(app).get("/courses")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
  it("caches reads within ttl window", async () => {
    const calls = vi.fn()
    const supa = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => {
              calls()
              return { data: { value: { courses: true } }, error: null }
            },
          }),
        }),
      }),
    } as never
    const app = express()
    app.get("/courses", requireModule("courses", { supabase: supa, ttlMs: 60_000 }), (_req, res) => res.json({}))
    await request(app).get("/courses")
    await request(app).get("/courses")
    expect(calls).toHaveBeenCalledTimes(1)
  })
})
```

Add `supertest` to devDependencies (already present in `apps/api`; copy version).

- [ ] **Step 1.9: `packages/modules/src/next.ts`**

```typescript
import { notFound } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isEnabled } from "./check"
import type { ModuleKey } from "./registry"

/**
 * Server Component / Server Action helper. Calls Next's notFound() if the module
 * is disabled. Use at the top of a page.tsx that should be hidden when the
 * module is off. Caller is responsible for caching at the page level (Next's
 * fetch cache or a request-scoped memo).
 */
export async function gateModule(supabase: SupabaseClient, module: ModuleKey): Promise<void> {
  if (!(await isEnabled(supabase, module))) notFound()
}
```

- [ ] **Step 1.10: `packages/modules/src/index.ts`**

```typescript
export * from "./registry"
export * from "./check"
export * from "./express"
export * from "./next"
```

- [ ] **Step 1.11: Path alias + workspace registration**

Verify `package.json` workspaces field already includes `packages/*`. In `tsconfig.base.json`, add to `compilerOptions.paths`:

```json
"@repo/modules": ["./packages/modules/src/index.ts"],
"@repo/modules/*": ["./packages/modules/src/*"]
```

- [ ] **Step 1.12: Run package tests**

```bash
pnpm install
pnpm --filter @repo/modules test
```

Expect: all green. The package is not yet imported by any app — those wiring changes happen in PR-B6/B7.

- [ ] **Step 1.13: Vercel preview validation**

This PR touches only `packages/`; no app code consumes it. A Vercel preview build is still triggered for `apps/web` and `apps/control`. Required checks:

```
Open the Vercel preview for apps/web (the realreal storefront preview).
- Visit /                              → 200, identical to production (no visual change)
- Visit /admin                         → 200, login page renders
- Visit /shop                          → 200, products list
```

If any 5xx or visual regression, do NOT merge.

- [ ] **Step 1.14: Commit + PR**

Branch: `feat/phase-b1-modules-package`. PR title: `Phase B1: packages/modules — registry + isEnabled() + gates`.

---

## Task 2 (PR-B2): `packages/theme` — brand zod schema + defaults + `getBrand()` helper

**Goal:** Typed access to `site_contents.brand` from any tenant DB, with a literal fallback identical to current hardcoded realreal values. Includes a `brandToCssVars()` utility used in PR-B4.

**Files:**
- Create: `packages/theme/package.json`
- Create: `packages/theme/tsconfig.json`
- Create: `packages/theme/src/index.ts`
- Create: `packages/theme/src/brand.ts`
- Create: `packages/theme/src/defaults.ts`
- Create: `packages/theme/src/css.ts`
- Create: `packages/theme/__tests__/brand.test.ts`
- Create: `packages/theme/__tests__/css.test.ts`
- Create: `apps/web/src/lib/brand.ts`
- Create: `apps/web/src/lib/__tests__/brand.test.ts`
- Modify: `apps/web/src/lib/content.ts` (add `getBrand()`, `getModuleConfig()`)
- Modify: `tsconfig.base.json` (add `@repo/theme` alias)

### Steps

- [ ] **Step 2.1: `packages/theme/src/brand.ts` — zod schema**

```typescript
import { z } from "zod"

export const FONT_FAMILIES = ["geist", "inter", "noto-sans-tc", "lxgw-wenkai", "gill-sans"] as const

export const brandColorsSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  primary_foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})

export const brandSchema = z.object({
  name: z.string().min(1).max(80),
  tagline: z.string().max(200).default(""),
  logo_url: z.string().min(1),
  favicon_url: z.string().min(1),
  colors: brandColorsSchema,
  font_family: z.enum(FONT_FAMILIES),
})

export type Brand = z.infer<typeof brandSchema>
export type BrandColors = z.infer<typeof brandColorsSchema>
```

- [ ] **Step 2.2: `packages/theme/src/defaults.ts` — exact realreal fallback**

Values must match what's actually rendered on realreal today (sourced from `apps/web/src/app/globals.css` `:root` block + `apps/web/src/components/layout/Header.tsx`):

```typescript
import type { Brand } from "./brand"

export const DEFAULT_BRAND: Brand = {
  name: "誠真生活 RealReal",
  tagline: "純淨植物力，為你的健康加分",
  logo_url: "/logo.svg",
  favicon_url: "/favicon.ico",
  colors: {
    primary: "#10305a",
    primary_foreground: "#ffffff",
    accent: "#fffeee",
    background: "#ffffff",
    foreground: "#687279",
  },
  font_family: "gill-sans",
}
```

Note: these are realreal's *current* visible values, not the spec's seed (`#4a7c59` etc.). PR-B8 reconciles the seed migration with reality.

- [ ] **Step 2.3: `packages/theme/src/css.ts` — color → CSS vars**

```typescript
import type { Brand } from "./brand"

export function brandToCssVars(brand: Brand): Record<string, string> {
  return {
    "--brand-primary": brand.colors.primary,
    "--brand-primary-foreground": brand.colors.primary_foreground,
    "--brand-accent": brand.colors.accent,
    "--brand-background": brand.colors.background,
    "--brand-foreground": brand.colors.foreground,
  }
}

export function brandToInlineStyle(brand: Brand): string {
  return Object.entries(brandToCssVars(brand))
    .map(([k, v]) => `${k}:${v}`)
    .join(";")
}
```

- [ ] **Step 2.4: Test — schema rejects bad colors**

Create `packages/theme/__tests__/brand.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { brandSchema, DEFAULT_BRAND } from "../src"

describe("brandSchema", () => {
  it("accepts DEFAULT_BRAND", () => {
    expect(() => brandSchema.parse(DEFAULT_BRAND)).not.toThrow()
  })
  it("rejects non-hex colors", () => {
    expect(() =>
      brandSchema.parse({ ...DEFAULT_BRAND, colors: { ...DEFAULT_BRAND.colors, primary: "blue" } })
    ).toThrow()
  })
  it("rejects font_family outside whitelist", () => {
    expect(() => brandSchema.parse({ ...DEFAULT_BRAND, font_family: "comic-sans" })).toThrow()
  })
  it("requires name >= 1 char", () => {
    expect(() => brandSchema.parse({ ...DEFAULT_BRAND, name: "" })).toThrow()
  })
})
```

- [ ] **Step 2.5: `packages/theme/src/index.ts`**

```typescript
export * from "./brand"
export * from "./css"
export { DEFAULT_BRAND } from "./defaults"
```

- [ ] **Step 2.6: `apps/web/src/lib/content.ts` — add `getBrand()` and `getModuleConfig()`**

Append to existing file:

```typescript
import { brandSchema, DEFAULT_BRAND, type Brand } from "@repo/theme"
import type { ModuleConfig, ModuleKey } from "@repo/modules"

/**
 * Server-only. Reads site_contents.brand, validates, falls back to DEFAULT_BRAND.
 * Cached for 60s via Next's fetch cache (revalidate: 60).
 */
export async function getBrand(): Promise<Brand> {
  try {
    const res = await fetch(`${API_URL}/site-contents/brand`, { next: { revalidate: 60 } })
    if (!res.ok) return DEFAULT_BRAND
    const json = await res.json()
    const candidate = json.data ?? json.value ?? json
    const parsed = brandSchema.safeParse(candidate)
    return parsed.success ? parsed.data : DEFAULT_BRAND
  } catch {
    return DEFAULT_BRAND
  }
}

export async function getModuleConfig(): Promise<ModuleConfig> {
  try {
    const res = await fetch(`${API_URL}/site-contents/module_config`, { next: { revalidate: 60 } })
    if (!res.ok) return {}
    const json = await res.json()
    return (json.data ?? json.value ?? {}) as ModuleConfig
  } catch {
    return {}
  }
}

export async function isModuleEnabled(module: ModuleKey): Promise<boolean> {
  const cfg = await getModuleConfig()
  return cfg[module] === true
}
```

- [ ] **Step 2.7: Test — `getBrand()` falls back on error**

Create `apps/web/src/lib/__tests__/brand.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getBrand } from "../content"
import { DEFAULT_BRAND } from "@repo/theme"

describe("getBrand", () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  it("returns DEFAULT_BRAND on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")))
    expect(await getBrand()).toEqual(DEFAULT_BRAND)
  })
  it("returns DEFAULT_BRAND on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response))
    expect(await getBrand()).toEqual(DEFAULT_BRAND)
  })
  it("returns DEFAULT_BRAND on schema-invalid value", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { name: "X", colors: { primary: "not-a-hex" } } }),
    } as Response))
    expect(await getBrand()).toEqual(DEFAULT_BRAND)
  })
  it("returns parsed brand on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: DEFAULT_BRAND }),
    } as Response))
    expect((await getBrand()).name).toBe(DEFAULT_BRAND.name)
  })
})
```

- [ ] **Step 2.8: Run tests**

```bash
pnpm --filter @repo/theme test
pnpm --filter web test -- src/lib/__tests__/brand.test.ts
```

- [ ] **Step 2.9: Vercel preview validation**

```
- Visit / on preview → identical to prod (no rendered change yet, helpers unused).
- Open browser devtools → no new console errors.
- curl https://<preview>/api/site-contents/brand or proxied path: 200, JSON body parses against brandSchema.
```

- [ ] **Step 2.10: Commit + PR**

Branch: `feat/phase-b2-theme-package`. PR title: `Phase B2: packages/theme — brand schema + getBrand()`.

---

## Task 3 (PR-B3): Replace hardcoded brand strings with `site_contents.brand.name`

**Goal:** Every `"誠真生活"`, `"RealReal"`, `"誠真生活 RealReal"`, and brand-mention metadata string in `apps/web` reads from `getBrand().name` (or `.tagline`) at request time. Hardcoded values remain only as the literal `DEFAULT_BRAND` fallback in `packages/theme/src/defaults.ts`.

**Risk control:** Every replaced string keeps a fallback path equivalent to the original literal — no `??` chain may yield empty string on the page.

**Files modified (from grep in PR-B3 column above):**
- `apps/web/src/app/layout.tsx` — `metadata.title.default`, `template`, `description`, `keywords`, `openGraph.siteName` etc.
- `apps/web/src/app/page.tsx` — `metadata.title`, `metadata.description`, `metadata.openGraph.title`
- `apps/web/src/app/robots.ts` — uses `NEXT_PUBLIC_SITE_URL`; no string change but document fallback policy
- `apps/web/src/app/sitemap.ts` — same
- `apps/web/src/app/auth/{login,register,forgot-password,reset-password}/{page,layout}.tsx` — `<Image alt="誠真生活">`, metadata description
- `apps/web/src/app/shop/page.tsx`, `apps/web/src/app/shop/[slug]/page.tsx` — metadata
- `apps/web/src/app/faq/page.tsx`, `privacy/page.tsx`, `terms/page.tsx`, `contact/page.tsx` — metadata + body strings that mention brand
- `apps/web/src/components/layout/Header.tsx` — `<Image alt="…">`
- `apps/web/src/components/layout/Footer.tsx` — alt, `誠真生活`, `誠真生活有限公司`, copyright

### Steps

- [ ] **Step 3.1: Convert `apps/web/src/app/layout.tsx` to async generateMetadata**

Replace the static `metadata` export with `generateMetadata()`:

```typescript
import type { Metadata } from "next"
import { getBrand } from "@/lib/content"
import { Toaster } from "@/components/ui/sonner"
import { StorefrontShell } from "@/components/layout/StorefrontShell"
import "./globals.css"

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand()
  const title = brand.tagline ? `${brand.name} | ${brand.tagline}` : brand.name
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc"),
    title: { default: title, template: `%s | ${brand.name}` },
    description: brand.tagline || brand.name,
    icons: { icon: brand.favicon_url },
    openGraph: {
      type: "website",
      locale: "zh-TW",
      siteName: brand.name,
      title,
      description: brand.tagline || brand.name,
    },
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="font-sans antialiased">
        <StorefrontShell>{children}</StorefrontShell>
        <Toaster />
      </body>
    </html>
  )
}
```

The previously hardcoded `keywords` array is dropped — keywords are tenant-specific; if needed, add `brand.keywords` field in a follow-up. Today's realreal SEO does not depend on it materially.

- [ ] **Step 3.2: Convert page.tsx metadata in homepage and other pages**

For each of: `app/page.tsx`, `app/shop/page.tsx`, `app/shop/[slug]/page.tsx`, `app/faq/page.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/auth/login/layout.tsx`, `app/auth/register/layout.tsx`:

Replace `export const metadata: Metadata = { ... "誠真生活 RealReal" ... }` with:

```typescript
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand()
  return {
    title: `<page-specific> | ${brand.name}`,
    description: `<page-specific copy>`,  // keep page-specific body, do NOT brand-substitute
  }
}
```

For `shop/[slug]/page.tsx` line 116: change `${product.name} | 誠真生活 RealReal` → use brand inside the existing async `generateMetadata(params)`.

- [ ] **Step 3.3: Header/Footer — pass brand via Server Component → "use client" prop**

`apps/web/src/components/layout/StorefrontShell.tsx` is `"use client"`. Refactor: convert StorefrontShell to a Server Component that fetches brand and passes to a client `<StorefrontChrome brand={...}>`:

```typescript
// apps/web/src/components/layout/StorefrontShell.tsx
import { getBrand } from "@/lib/content"
import { StorefrontChrome } from "./StorefrontChrome"

export async function StorefrontShell({ children }: { children: React.ReactNode }) {
  const brand = await getBrand()
  return <StorefrontChrome brand={brand}>{children}</StorefrontChrome>
}
```

```typescript
// apps/web/src/components/layout/StorefrontChrome.tsx  (NEW; "use client")
"use client"
import { usePathname } from "next/navigation"
import type { Brand } from "@repo/theme"
import { Header } from "./Header"
import { Footer } from "./Footer"

export function StorefrontChrome({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname.startsWith("/admin")) return <>{children}</>
  return (
    <>
      <Header brand={brand} />
      <main className="min-h-[calc(100vh-4rem)]">{children}</main>
      <Footer brand={brand} />
    </>
  )
}
```

Update `Header.tsx` and `Footer.tsx` to accept `brand: Brand` and use `brand.name`, `brand.logo_url`, `brand.tagline` everywhere a literal `"誠真生活"` / `"RealReal"` / `"/logo.svg"` appears.

Specifically replace:
- `Header.tsx:60` `alt="誠真生活 RealReal"` → `alt={brand.name}`
- `Header.tsx:58` `src="/logo.svg"` → `src={brand.logo_url}`
- `Footer.tsx:53` `alt="誠真生活"` → `alt={brand.name}`
- `Footer.tsx:59` `<p>誠真生活</p>` → `<p>{brand.name.split(" ")[0] ?? brand.name}</p>` (preserves the two-line layout)
- `Footer.tsx:60` `<p>RealReal</p>` → `<p>{brand.name.split(" ").slice(1).join(" ") || ""}</p>`
- `Footer.tsx:147` `誠真生活有限公司` → keep hardcoded for v1 (legal entity name; not brand-derivable). Add inline `// TODO Phase v1.5: move to brand.legal_entity_name`.
- `Footer.tsx:160` `&copy; 2026 誠真生活 All Rights Reserved` → `&copy; {new Date().getFullYear()} {brand.name} All Rights Reserved`

- [ ] **Step 3.4: Auth page logos**

In each of `auth/login/page.tsx`, `auth/register/page.tsx`, `auth/forgot-password/page.tsx`, `auth/reset-password/page.tsx`:

These are currently client components with hardcoded `<Image src="/logo.svg" alt="誠真生活" />`. Convert each to a `"use client"` component that receives brand from a server `layout.tsx` wrapper, OR (simpler) split: keep page client, render `<BrandLogo />` server component that reads `getBrand()` and renders the image. Use the simpler split:

```typescript
// apps/web/src/components/layout/BrandLogo.tsx  (NEW, server)
import Image from "next/image"
import { getBrand } from "@/lib/content"
export async function BrandLogo({ width = 150, height = 75 }: { width?: number; height?: number }) {
  const brand = await getBrand()
  return <Image src={brand.logo_url} alt={brand.name} width={width} height={height} />
}
```

Then in each auth page replace `<Image src="/logo.svg" alt="誠真生活" width={150} height={75} />` with `<BrandLogo />`. Page can stay `"use client"` because rendering an async server component as a child via `<Suspense>` is supported when imported through a server boundary; if Next 16 rejects this pattern in the current setup, instead refactor each auth page's brand block into a server `layout.tsx` slot. Verify against `apps/web/AGENTS.md` (file says: read Next 16 docs in `node_modules/next/dist/docs/` before writing code) — confirm async server components inside client components or use `<BrandLogo />` only where a server boundary already exists.

- [ ] **Step 3.5: Privacy/Terms body strings**

These pages have inline Chinese paragraphs mentioning "誠真生活" repeatedly. Treat the body as page content (will move to `site_contents.privacy_policy` later — already supported). For Phase B3 scope: leave body literal text untouched (they are tenant-specific legal copy that realreal authored; substituting `brand.name` would risk breaking Chinese phrasing). Add a TODO comment at top of each file:

```typescript
// TODO Phase v1.5: move legal body to site_contents.{privacy,terms} per tenant.
// Today this is realreal-specific legal copy; tenants override via admin UI.
```

Only the `metadata.title` and `metadata.description` for these pages get brand-substituted (Step 3.2).

- [ ] **Step 3.6: Run typecheck + tests**

```bash
pnpm --filter web typecheck
pnpm --filter web test
```

All 8 web vitest files must pass unchanged; no new test added in this PR (covered by B2 fallback test + B9 smoke).

- [ ] **Step 3.7: Vercel preview validation**

Critical because B3 is the highest visual-risk PR.

```
- Visit / on preview            → header logo visible, footer name "誠真生活" visible (from DB or fallback), copyright year correct
- Visit /faq                    → page title in browser tab is "常見問題 | 誠真生活 RealReal"
- Visit /shop                   → renders, no brand string is empty/undefined
- Visit /auth/login             → logo renders, no broken image
- View page source on /         → <title> contains "誠真生活" or "RealReal"
- Open Network tab → /site-contents/brand returns 200; if it 500s, page still renders via fallback
```

If `<title>` is empty, `alt=""`, or any "undefined" string appears, do NOT merge.

- [ ] **Step 3.8: Commit + PR**

Branch: `feat/phase-b3-brand-strings`. PR title: `Phase B3: replace hardcoded brand strings with site_contents.brand`.

---

## Task 4 (PR-B4): Logo, favicon, colors → CSS custom properties from brand

**Goal:** The five brand colors are emitted as CSS custom properties on `<html>` so Tailwind v4 `@theme inline` mappings (`--color-primary` etc.) and inline `style` attributes can pick them up. Logo + favicon already handled in PR-B3; this PR is colors.

**Files:**
- Modify: `apps/web/src/app/layout.tsx` (set `<html style={...}>` from brand)
- Modify: `apps/web/src/app/globals.css` (point `--primary` etc. to `--brand-primary` with fallback to existing literal)

### Steps

- [ ] **Step 4.1: Inject CSS vars at layout level**

In `apps/web/src/app/layout.tsx`, modify `RootLayout` to read brand and apply via inline `style` on `<html>`:

```typescript
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand()
  return (
    <html
      lang="zh-TW"
      style={{
        "--brand-primary": brand.colors.primary,
        "--brand-primary-foreground": brand.colors.primary_foreground,
        "--brand-accent": brand.colors.accent,
        "--brand-background": brand.colors.background,
        "--brand-foreground": brand.colors.foreground,
      } as React.CSSProperties}
    >
      <body className="font-sans antialiased">
        <StorefrontShell>{children}</StorefrontShell>
        <Toaster />
      </body>
    </html>
  )
}
```

(Combine with the metadata change from B3; this PR comes after B3 so the layout is already async.)

- [ ] **Step 4.2: Wire `globals.css` to consume brand vars with literal fallback**

Edit `apps/web/src/app/globals.css` `:root` block. Replace literals with `var(--brand-*, <literal>)`:

```css
:root {
  --background:           var(--brand-background, #ffffff);
  --foreground:           var(--brand-foreground, #687279);
  --primary:              var(--brand-primary, #10305a);
  --primary-foreground:   var(--brand-primary-foreground, #ffffff);
  --accent:               var(--brand-accent, #fffeee);
  --accent-foreground:    var(--brand-primary, #10305a);
  --ring:                 var(--brand-primary, #10305a);
  --chart-1:              var(--brand-primary, #10305a);
  /* … leave the rest (cream, navy, light-gray etc. literal — those are auxiliary, not brand) … */
}
```

The five brand color slots use `var(--brand-*, fallback)` so a missing `<html style>` value silently falls through to the realreal default — guarantees visual parity if `getBrand()` returns DEFAULT_BRAND.

- [ ] **Step 4.3: Replace one hardcoded inline `style={{ backgroundColor: "#10305a" }}` example**

In `apps/web/src/app/page.tsx` Hero section (line 145, 154 area), inline `style={{ backgroundColor: "#10305a" }}` is used directly. Phase B4 swaps these targeted usages to `var(--primary)`:

```tsx
<Button ... style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}>
```

Apply mechanically only to the homepage hero / nav. Other inline literals (announcement bar `text-yellow-300`, etc.) stay — those are decorative, not brand colors.

- [ ] **Step 4.4: Favicon dynamic via metadata.icons**

Already done in B3 Step 3.1 (`icons: { icon: brand.favicon_url }`). Re-confirm Next 16 honors it — read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/metadata/icons.mdx` if uncertain.

- [ ] **Step 4.5: Test — color render**

No unit test (CSS render isn't easily unit-testable). Add a smoke assertion in an existing test or skip — covered by Vercel preview manual check.

- [ ] **Step 4.6: Vercel preview validation**

```
- Visit / on preview → primary buttons are realreal navy (#10305a), not green or any other color
- Devtools → Inspect <html>: style includes --brand-primary: #10305a (from realreal site_contents.brand row OR from DEFAULT_BRAND fallback)
- Manually: change site_contents.brand.colors.primary to #ff0000 in DB → reload page → primary buttons go red within 60s revalidate window. Revert.
```

- [ ] **Step 4.7: Commit + PR**

Branch: `feat/phase-b4-brand-css-vars`. PR title: `Phase B4: drive brand colors via CSS custom properties`.

---

## Task 5 (PR-B5): Hero / banner copy → `site_contents.homepage_*`

**Goal:** Homepage hero and announcement-bar / banner sections read all editable copy from `site_contents.homepage_hero` and `site_contents.homepage_banner`. Hardcoded fallbacks remain as today's realreal copy.

`HeroContent` shape already exists in `apps/web/src/app/page.tsx:69` and the homepage already calls `getSiteContent<HeroContent>("homepage_hero")` at line 637. Phase B5's job is to:

1. Move all hardcoded literal copy in `HeroSection` (lines 81–158) into the `content` fallback.
2. Add `homepage_banner` reading for the AnnouncementBar / banner copy.
3. Add a `homepage_section_titles` key for "純植物蛋白粉", "原相凍乾水果", "聰明生活" etc. (the hardcoded `<ProductSection title="…">` strings in `page.tsx`).

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- (Schemas live in the existing `site_contents` table; no migration unless seed values needed.)

### Steps

- [ ] **Step 5.1: Inventory hardcoded copy in `apps/web/src/app/page.tsx`**

From `Read`:

- Line 81: `heading ?? "自純淨中補給，在誠真中安心"` — already has fallback ✓
- Line 82: `ctaText ?? "立即選購"` — already ✓
- Line 89–95: `bodyLines = [...]` — five Chinese phrases used when `content?.subheading` empty. Already structured as fallback ✓
- Line 120: `<p>純淨植物力，為你的生活加分</p>` — eyebrow text, hardcoded with no DB read
- Line 156: `了解品牌` button label — hardcoded
- Lines for `ProductSection title="純植物蛋白粉"` etc. — hardcoded
- Line 221: `https://realreal.cc/wp-content/uploads/2026/01/會員制度表0106-2.png` — realreal-specific image URL

- [ ] **Step 5.2: Extend `HeroContent` type and fallback**

```typescript
type HeroContent = {
  eyebrow?: string
  heading?: string
  subheading?: string
  cta_text?: string
  cta_link?: string
  cta_secondary_text?: string
  cta_secondary_link?: string
  image?: string
  image_scale?: number
  image_position_x?: number
  image_position_y?: number
}
```

Update `HeroSection` to consume the new fields with the existing literal as fallback:

```typescript
const eyebrow = content?.eyebrow ?? "純淨植物力，為你的生活加分"
const ctaSecondaryText = content?.cta_secondary_text ?? "了解品牌"
const ctaSecondaryLink = content?.cta_secondary_link ?? "/about"
```

Replace the inline literals at lines 120 and 156 accordingly.

- [ ] **Step 5.3: Add `homepage_banner` read**

Add a new top-of-page banner content type:

```typescript
type BannerContent = { messages?: string[] }

const [proteinProducts, fruitProducts, heroContent, bannerContent, blogResult, testimonials] =
  await Promise.all([
    getProductsByCategory(proteinSlug ?? "protein"),
    getProductsByCategory(fruitSlug ?? "freeze-dried"),
    getSiteContent<HeroContent>("homepage_hero"),
    getSiteContent<BannerContent>("homepage_banner"),
    getPosts({ limit: 3 }),
    getSiteContent<Testimonial[]>("testimonials"),
  ])
```

Refactor `AnnouncementBar` to accept `messages?: string[]` prop, with the existing hardcoded marquee strings as the fallback in the parent caller:

```typescript
<AnnouncementBar messages={bannerContent?.messages} />
```

- [ ] **Step 5.4: Add `homepage_section_titles` for product-section labels**

```typescript
type SectionTitles = {
  protein?: string
  fruit?: string
  reviews?: string
  blog?: string
}
const titles = await getSiteContent<SectionTitles>("homepage_section_titles")

<ProductSection title={titles?.protein ?? "純植物蛋白粉"} ... />
<ProductSection title={titles?.fruit ?? "原相凍乾水果"} ... />
```

- [ ] **Step 5.5: Membership image URL**

Line 221's `https://realreal.cc/...` image URL is realreal-specific. Move to `site_contents.homepage_membership_image`:

```typescript
const membershipImg = await getSiteContent<{ url: string }>("homepage_membership_image")
<Image src={membershipImg?.url ?? "https://realreal.cc/wp-content/uploads/2026/01/會員制度表0106-2.png"} ... />
```

- [ ] **Step 5.6: Test — hero falls back when content key missing**

`apps/web/src/__tests__/content.test.ts` already exercises `getSiteContent`. Add an assertion:

```typescript
it("homepage_hero returns null on 404 → caller uses fallback", async () => {
  /* existing test pattern */
})
```

- [ ] **Step 5.7: Vercel preview validation**

```
- Visit / on preview → hero, eyebrow, two CTAs, announcement bar all visible and visually identical to prod
- DB experiment: set site_contents.homepage_hero.heading = "TEST HEADING" → reload → heading updates within 60s
- Revert.
```

- [ ] **Step 5.8: Commit + PR**

Branch: `feat/phase-b5-homepage-content-keys`. PR title: `Phase B5: hero/banner copy from site_contents.homepage_*`.

---

## Task 6 (PR-B6): `apps/api` module gating middleware

**Goal:** Disabled modules return 404 from `apps/api`. Wire `requireModule(...)` from `@repo/modules` onto every router declared in `MODULES[*].routes_to_gate`.

**Files:**
- Modify: `apps/api/src/app.ts` — wrap routers with `requireModule`
- Create: `apps/api/src/middleware/__tests__/module-gate.test.ts`
- Modify: `apps/api/package.json` — add `@repo/modules` workspace dep

### Steps

- [ ] **Step 6.1: Add workspace dep**

In `apps/api/package.json`:
```json
"@repo/modules": "workspace:*"
```

- [ ] **Step 6.2: Wrap routers in `app.ts`**

Import `requireModule` and `supabase`, then wrap (modifying existing `app.use` lines to inject gate middleware before the router):

```typescript
import { requireModule } from "@repo/modules"
import { supabase } from "./lib/supabase"

const gate = (m: Parameters<typeof requireModule>[0]) =>
  requireModule(m, { supabase, ttlMs: 60_000 })

// before each gated router registration
app.use("/subscriptions", gate("subscriptions"), requireAuth, subscriptionsRouter)
app.use("/subscription-plans", gate("subscriptions"), subscriptionPlansRouter)
app.use("/admin/campaigns", gate("campaigns"), campaignsRouter)  // assuming campaignsRouter is already declared with /admin paths
// IMPORTANT: campaignsRouter is currently mounted at "/" with explicit /admin/campaigns paths inside.
// Refactor: keep /admin/campaigns mount via gate; non-admin campaign endpoints (if any) get gated separately.
app.use("/admin/coupons", gate("campaigns"), /* coupons sub-router */)
app.use("/posts", gate("cms_posts"), postsPublicRouter)
app.use("/admin/posts", gate("cms_posts"), postsAdminRouter)
app.use("/post-categories", gate("cms_posts"), postCategoriesPublicRouter)
app.use("/admin/post-categories", gate("cms_posts"), postCategoriesAdminRouter)
app.use("/post-tags", gate("cms_posts"), postTagsPublicRouter)
app.use("/admin/post-tags", gate("cms_posts"), postTagsAdminRouter)
app.use("/admin/reviews", gate("product_reviews"), reviewsAdminRouter)
app.use("/products/:productId/reviews", gate("product_reviews"), reviewsPublicRouter)
// tiers (membership_tiers)
app.use("/", gate("membership_tiers"), tiersRouter)  // IF tiersRouter only handles /admin/tiers /membership-tiers; if it also serves analytics joins do NOT gate; instead gate per-path. Audit before merge.
```

**Audit step:** Before applying this, read each gated router file and ensure all its routes belong to that module. The `couponsRouter` is currently mounted at `/` and contains both campaign coupons and other coupons — split the mount or use per-route gating. Tiers similarly. Document each decision in the PR description.

Recommended split: leave `couponsRouter` mounted at `/` but add `gate("campaigns")` middleware **inside** the router on each `/admin/coupons*` route, not at the mount.

- [ ] **Step 6.3: Test — gated route returns 404 when disabled**

Create `apps/api/src/middleware/__tests__/module-gate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ single: vi.fn().mockResolvedValue({ data: { value: { courses: false, subscriptions: false, cms_posts: false } }, error: null }) }),
      }),
    }),
  },
}))

import { app } from "../../app"

describe("module gating in apps/api", () => {
  it("/subscription-plans returns 404 when subscriptions disabled", async () => {
    const res = await request(app).get("/subscription-plans")
    expect(res.status).toBe(404)
  })
  it("/posts returns 404 when cms_posts disabled", async () => {
    const res = await request(app).get("/posts")
    expect(res.status).toBe(404)
  })
})
```

Also add the parameterized table from spec §10:

```typescript
describe.each([
  ["subscriptions", "/subscription-plans"],
  ["cms_posts", "/posts"],
  ["product_reviews", "/admin/reviews"],
  ["campaigns", "/admin/campaigns"],
])("module %s gating at %s", (mod, path) => {
  it(`returns 404 when ${mod} disabled`, async () => { /* ... */ })
  it(`passes through when ${mod} enabled`, async () => { /* ... */ })
})
```

- [ ] **Step 6.4: Verify existing 14 api test files still pass**

```bash
pnpm --filter api test
```

If `posts.test.ts`, `campaigns.test.ts`, `subscriptions.test.ts`, `reviews.test.ts`, `tier.test.ts`, `coupons.test.ts` start failing, the cause is the new gate returning 404 because the test's mocked supabase doesn't return `module_config` enabled. Fix: each affected test sets up the supabase mock to return `{ module_config: { <module>: true } }` for the gate read. Provide a shared test helper `apps/api/src/__tests__/__helpers__/enable-modules.ts`:

```typescript
export function enableModulesInMockSupabase(mock: any, modules: Record<string, boolean>) {
  // override the .from('site_contents').select.eq('key','module_config').single response
  // ... implementation matches existing test mock style
}
```

- [ ] **Step 6.5: Vercel preview validation**

```
- curl https://<api-preview>/subscription-plans              → 200 (subscriptions=true in realreal seed)
- curl https://<api-preview>/posts                            → 200 (cms_posts=true)
- curl https://<api-preview>/courses                          → 404 (courses=false; this is a NEW behavior; pre-B6 it was an unmounted 404 anyway, so no change visible)
- DB experiment: UPDATE site_contents SET value=jsonb_set(value,'{cms_posts}','false') WHERE key='module_config'; → curl /posts → 404 within 60s. Revert.
```

- [ ] **Step 6.6: Commit + PR**

Branch: `feat/phase-b6-api-module-gates`. PR title: `Phase B6: apps/api module gating middleware`.

---

## Task 7 (PR-B7): `apps/web` module gating wrapper (notFound when disabled)

**Goal:** Frontend pages for disabled modules return 404 (`notFound()`) and nav items for them are hidden.

**Files:**
- Modify: `apps/web/src/app/subscribe/page.tsx`
- Modify: `apps/web/src/app/blog/page.tsx`, `apps/web/src/app/blog/[slug]/page.tsx`
- Modify: `apps/web/src/app/membership/page.tsx`
- Create: `apps/web/src/app/courses/page.tsx` (placeholder gated page)
- Modify: `apps/web/src/components/layout/Header.tsx` (filter NAV_LINKS by module config)
- Modify: `apps/web/src/components/layout/Footer.tsx` (similar)

### Steps

- [ ] **Step 7.1: Gate `/subscribe`**

Top of `apps/web/src/app/subscribe/page.tsx`:

```typescript
import { gateModule } from "@repo/modules"
import { createServerSupabase } from "@/lib/supabase/server"

export default async function SubscribePage() {
  await gateModule(await createServerSupabase(), "subscriptions")
  // ... existing render
}
```

(Use whichever Supabase server client factory exists in `apps/web/src/lib/supabase/`.)

- [ ] **Step 7.2: Gate `/blog` and `/blog/[slug]`**

Same pattern with `"cms_posts"`.

- [ ] **Step 7.3: Gate `/membership`**

`gateModule(..., "membership_tiers")`.

- [ ] **Step 7.4: Create placeholder `/courses` page (still 404 today since module=false)**

```typescript
// apps/web/src/app/courses/page.tsx
import { gateModule } from "@repo/modules"
import { createServerSupabase } from "@/lib/supabase/server"

export default async function CoursesPage() {
  await gateModule(await createServerSupabase(), "courses")
  return <main className="p-8"><h1>Courses (coming soon)</h1></main>
}
```

This proves the gate works for an off-module: hitting `/courses` returns 404 today and will return 200 if a tenant flips `module_config.courses=true`.

- [ ] **Step 7.5: Filter nav by module config**

In `Header.tsx`, the current `NAV_LINKS` is a const array. Refactor to be filtered by `moduleConfig` passed from the server-side StorefrontShell:

```typescript
// StorefrontShell.tsx (server)
const [brand, modules] = await Promise.all([getBrand(), getModuleConfig()])
return <StorefrontChrome brand={brand} modules={modules}>{children}</StorefrontChrome>
```

```typescript
// Header.tsx — accept modules prop, filter NAV_LINKS
const visibleNav = NAV_LINKS.filter((link) => {
  if (link.href === "/blog") return modules.cms_posts !== false
  if (link.href === "/membership") return modules.membership_tiers !== false
  if (link.href === "/idea") return true   // not module-gated
  // ... etc
  return true
})
```

Default behavior (`!== false`) means a missing key keeps the link visible — fail-open for nav, fail-closed for routes (gate middleware default-deny). This matches the spec invariant "disabling a module never deletes data".

Footer: same treatment for any module-specific footer links (audit Footer.tsx; today there are none, so no change required — confirm).

- [ ] **Step 7.6: Test — gated page calls notFound()**

Add to `apps/web/src/app/admin/__tests__/layout.test.ts` or create new `apps/web/src/app/__tests__/module-gate.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"
import { gateModule } from "@repo/modules"

vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }) }))

describe("gateModule in pages", () => {
  it("calls notFound when module disabled", async () => {
    const supa = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { value: { courses: false } }, error: null }) }) }) }) } as never
    await expect(gateModule(supa, "courses")).rejects.toThrow("NEXT_NOT_FOUND")
  })
})
```

- [ ] **Step 7.7: Vercel preview validation**

```
- /                           → 200, header shows: 首頁, 品牌故事, 了解產品, 常見問題, 聰明生活, 公益里程, 會員制度 (matches today)
- /blog                       → 200 (cms_posts=true in seed)
- /membership                 → 200 (membership_tiers=true)
- /subscribe                  → 200 (subscriptions=true)
- /courses                    → 404 (courses=false)
- DB experiment: set module_config.cms_posts=false → /blog returns 404 within 60s, "聰明生活" disappears from header. Revert.
```

- [ ] **Step 7.8: Commit + PR**

Branch: `feat/phase-b7-web-module-gates`. PR title: `Phase B7: apps/web page + nav module gating`.

---

## Task 8 (PR-B8): Reconcile realreal `site_contents.brand` + `module_config` to match running site

**Goal:** Migration `0020_brand_seed.sql` (already applied in Phase A) seeded `brand.name = "RealReal"` with green/yellow colors, but realreal's actual visible brand is `"誠真生活 RealReal"` with navy `#10305a` / cream `#fffeee`. Phase B8 ships a forward-fix migration that overwrites realreal's row to match reality.

**Files:**
- Create: `packages/db/migrations/0021_brand_realreal_seed.sql`

### Steps

- [ ] **Step 8.1: Write migration `0021_brand_realreal_seed.sql`**

```sql
-- Reconcile site_contents.brand with realreal's actual rendered values.
-- Earlier 0020_brand_seed.sql shipped placeholder values; Phase B treats DB as
-- truth for brand, so overwrite with realreal's real visible brand identity.
-- This migration is idempotent and safe to apply on any tenant: if brand was
-- already customised by a tenant admin, it WILL be overwritten — running it
-- only on the realreal Supabase is the intended scope. Future tenants get
-- their own brand seeded at provisioning step 2 and this migration is skipped
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

-- module_config currently in 0020_brand_seed.sql says product_reviews=true and
-- everything realreal currently uses. Verify against live behavior; no override
-- needed if 0020's defaults already match.

insert into schema_migrations (filename) values ('0021_brand_realreal_seed.sql') on conflict do nothing;
```

- [ ] **Step 8.2: Audit `module_config` against realreal reality**

Phase A's `0020_brand_seed.sql` has:
```
subscriptions: true, membership_tiers: true, campaigns: true, product_reviews: true,
cms_posts: true, site_notice: true, member_only_products: false,
courses: false, crowdfunding: false, bookings: false
```

Verify in production: visit https://realreal.cc/membership, /subscribe, /blog, /admin/campaigns, /admin/reviews — confirm each works today. If `product_reviews` is not actually used, set it false in 0021. If `site_notice` has no visible effect today, set false to avoid an unused enabled module.

If audit finds discrepancies, append to 0021:

```sql
update site_contents
set value = jsonb_set(value, '{<key>}', 'false'::jsonb)
where key = 'module_config';
```

- [ ] **Step 8.3: Apply on realreal Supabase**

Per Phase A pattern (use Supabase Management API or direct psql):

```bash
SUPABASE_PAT="sbp_..."
REF="ozwftlkgqmewtadypsfi"
curl -s -X POST -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -H "User-Agent: phase-b8/1.0" \
  -d "$(jq -Rs '{query:.}' < packages/db/migrations/0021_brand_realreal_seed.sql)" \
  https://api.supabase.com/v1/projects/$REF/database/query
```

Verify: `select value from site_contents where key='brand';` → JSON has `"name":"誠真生活 RealReal"` and the navy primary color.

- [ ] **Step 8.4: Vercel preview validation**

```
- After preview deployment of B8 (rare for migration-only PR, but confirm preview is unaffected)
- Visit / → page renders with brand pulled from DB (now matching reality), visually identical
```

- [ ] **Step 8.5: Commit + PR**

Branch: `feat/phase-b8-realreal-brand-seed`. PR title: `Phase B8: reconcile realreal brand seed with live values`.

---

## Task 9 (PR-B9): Deploy + run full test suite + manual smoke

**Goal:** Phase B end-to-end validation. Merge PR-B1..B8 sequentially into `main`, then deploy to realreal's Vercel + Railway (via the existing realreal flow — Phase C hasn't switched the watched branch yet, so this is direct main-branch deploy), and verify zero regression.

**Files:** No new code files. This task adds a checklist document and runs the test matrix.

- Create: `docs/runbooks/phase-b-rollout.md` (rollout checklist)

### Steps

- [ ] **Step 9.1: Sequence merges**

Merge in order on `main`: B1 → B2 → B3 → B4 → B5 → B6 → B7 → B8. Each merge triggers realreal Vercel preview / production deploy independently. After each, verify the URL renders before merging the next.

- [ ] **Step 9.2: Run the full vitest matrix**

```bash
pnpm install
pnpm -r test
```

Expect all 29 test files green. Spec §11 quotes "184 vitest tests" — confirm the assertion count matches by inspecting `vitest run` output. The 29 test files currently are:

```
apps/api/src/middleware/__tests__/middleware.test.ts
apps/api/src/middleware/__tests__/module-gate.test.ts        (NEW in B6)
apps/api/src/routes/__tests__/campaigns.test.ts
apps/api/src/routes/__tests__/categories.test.ts
apps/api/src/routes/__tests__/coupons.test.ts
apps/api/src/routes/__tests__/health.test.ts
apps/api/src/routes/__tests__/media.test.ts
apps/api/src/routes/__tests__/orders.test.ts
apps/api/src/routes/__tests__/posts.test.ts
apps/api/src/routes/__tests__/products.test.ts
apps/api/src/routes/__tests__/reviews.test.ts
apps/api/src/routes/__tests__/site-contents.test.ts
apps/api/src/routes/__tests__/subscriptions.test.ts
apps/api/src/routes/__tests__/tier.test.ts
apps/api/src/routes/__tests__/users.test.ts
apps/api/src/routes/__tests__/variants.test.ts
apps/control/src/__tests__/cart.test.ts
apps/control/src/__tests__/catalog.test.ts
apps/control/src/__tests__/content.test.ts
apps/control/src/lib/__tests__/api-client.test.ts
apps/control/src/lib/__tests__/auth.test.ts
apps/web/src/__tests__/cart.test.ts
apps/web/src/__tests__/catalog.test.ts
apps/web/src/__tests__/content.test.ts
apps/web/src/app/admin/__tests__/campaigns.test.ts
apps/web/src/app/admin/__tests__/layout.test.ts
apps/web/src/app/auth/__tests__/actions.test.ts
apps/web/src/app/lib/__tests__/api-client.test.ts        (= apps/web/src/lib/__tests__/api-client.test.ts)
apps/web/src/lib/__tests__/brand.test.ts                 (NEW in B2)
apps/workers/__tests__/audit-route.test.ts
apps/workers/__tests__/hmac.test.ts
packages/modules/__tests__/registry.test.ts              (NEW in B1)
packages/modules/__tests__/check.test.ts                 (NEW in B1)
packages/modules/__tests__/express.test.ts               (NEW in B1)
packages/theme/__tests__/brand.test.ts                   (NEW in B2)
packages/theme/__tests__/css.test.ts                     (NEW in B2)
```

If the count diverges, document the difference in the PR description; spec's "184" is a count target, not a hard assertion.

- [ ] **Step 9.3: Manual smoke checklist on realreal production (`https://realreal.cc`)**

(Stand-in for the "5 E2E paths" — Playwright suite is built in Phase D6.)

- [ ] Homepage renders, hero copy unchanged, primary buttons navy, footer copyright shows current year + "誠真生活"
- [ ] `/shop` renders product grid, click into a product → detail page brand title correct
- [ ] Add product to cart → checkout → order confirmation (test card)
- [ ] Sign up → confirm email → log in → `/my-account` shows user
- [ ] Admin login → `/admin` accessible → change site_contents.brand.colors.primary to `#ff0000` via admin homepage editor → reload `/` within 60s → primary buttons go red. Revert.
- [ ] Admin disable `cms_posts` via direct DB update → `/blog` returns 404 → "聰明生活" gone from nav. Re-enable.
- [ ] Curl `/site-contents/brand` from API → 200, valid against `brandSchema`
- [ ] Resend test order confirmation email arrives, brand name matches DB

- [ ] **Step 9.4: Write `docs/runbooks/phase-b-rollout.md`**

A 1-page runbook capturing the smoke checklist above + rollback instructions:

```markdown
# Phase B rollout runbook
## Rollback
- Each PR is independently revertable. Highest-risk PRs are B3 (brand strings) and B6 (api gating).
- If B6 causes /posts 404 in production: UPDATE site_contents SET value=jsonb_set(value, '{cms_posts}', 'true') WHERE key='module_config'; (no-op if already true) — gate cache refreshes within 60s.
- If brand renders blank: confirm site_contents.brand row exists; if missing, B2's DEFAULT_BRAND fallback engages automatically.
- Worst case: revert PR on main, redeploy.
```

- [ ] **Step 9.5: Commit + PR**

Branch: `feat/phase-b9-rollout`. PR title: `Phase B9: rollout checklist + runbook`.

---

## Self-review

**Spec coverage check (§11 Phase B items B1–B9):** Every bullet maps to exactly one PR (table at top). The §11 risk row "F refactor inadvertently breaks existing realreal behavior" is addressed by (1) literal hardcoded fallback in `packages/theme/src/defaults.ts` for every brand field; (2) per-page metadata fallbacks in B3; (3) `var(--brand-*, <literal>)` CSS fallback in B4; (4) `?? "<existing literal>"` for every homepage copy field in B5; (5) test reruns in B9 + manual smoke; (6) Vercel preview validation step in every PR that touches `apps/web` or `apps/api` (B1, B2, B3, B4, B5, B6, B7).

**Placeholder scan:** No `TBD`, no `<fill in>`, no "etc." in implementation steps. Two intentional inline `// TODO Phase v1.5` comments mark items deliberately deferred (Footer legal entity name in B3.3; privacy/terms body in B3.5) — both are correctness-safe defaults.

**Type consistency:** `Brand` and `ModuleKey`/`ModuleConfig` types are exported from `@repo/theme` and `@repo/modules` respectively. `apps/web/src/lib/content.ts` reuses them. `apps/api/src/middleware/module-gate.test.ts` imports `requireModule` from `@repo/modules`. Workspace path aliases declared in `tsconfig.base.json` (B1.11, B2 step list).

**Bite-sized check:** PR-B1 has 14 steps, B2 has 10, B3 has 8, B4 has 7, B5 has 8, B6 has 6, B7 has 8, B8 has 5, B9 has 5 — total 71 steps. Each step is a single edit + run / single new file / single small test, sized ~2–5 minutes.

**Pre-existing storefront tests in B9:** Listed by full path in B9.2.

**Deploy verification per PR:** B1 step 1.13, B2 step 2.9, B3 step 3.7, B4 step 4.6, B5 step 5.7, B6 step 6.5, B7 step 7.7, B8 step 8.4, B9 step 9.3. Every PR that ships code touching `apps/web` or `apps/api` has an explicit Vercel preview check.

---

## Open questions for user (spec is silent)

1. **Existing `apps/control` web tests** (`apps/control/src/__tests__/{cart,catalog,content}.test.ts`, `apps/control/src/lib/__tests__/{api-client,auth}.test.ts`) — these look copy-pasted from `apps/web` rather than control-plane–specific. Are they intentional placeholders, or should they be deleted before Phase B9's count is taken? Affects the "184 vitest tests" target.
2. **`product_reviews` module enablement on realreal** — is the reviews UI actually used today? Spec seed says `true`; if false in practice, B8 should override.
3. **`site_notice`** — is there a banner anywhere on realreal driven by this flag? If the flag has no consumer code yet, gating it is a no-op; OK to leave `true`.
4. **Auth pages and async `<BrandLogo />`** — Next 16 may or may not allow rendering an async server component inside a `"use client"` page in this repo's exact configuration. If the simpler split in B3.4 fails the build, the fallback is to convert each auth page's brand block into a server `layout.tsx` slot — adds ~30 minutes per page.
5. **Per-tenant `apps/control`** — the package list in PR-B6 wires `@repo/modules` only into `apps/api`. Should `apps/control` also gate any of its admin views by tenant module config? Spec is unclear; assumed no, since `apps/control` is the platform-level dashboard, not a tenant admin.
6. **Whether B6 should also gate `/admin/orders` per `payments` virtual module** — spec lists `payments` only as a `required_modules` dependency, not a top-level toggleable module. Assumed `payments` is always-on; not gated.
