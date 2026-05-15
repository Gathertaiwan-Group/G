# Phase E — GA Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the merged, deployed multi-tenant platform (Phases A–D) to General Availability — polish the `apps/control` dashboard into an operable cockpit (KPIs, tenant filter/search, retry-provisioning, suspend, billing, deploy-monitor + auto-rollback), ship the six operational runbooks the spec requires before GA, and produce the customer welcome email + MCP usage documentation — while cleanly fencing off the inherently human/financial GA cutover actions (DNS, Stripe live mode, paying customer onboarding) into a USER-ACTIONABLE go-live checklist that no agent executes.

**Architecture:** Phase E is overwhelmingly **documentation + read-mostly dashboard polish**, with one piece of new automation (the deploy `monitor` job + auto-rollback that Phase D explicitly deferred). The control dashboard is Next 16 App Router (`apps/control`, server components reading the control Supabase via the existing `createControlClient`); new mutating actions (retry provisioning step, suspend tenant, token rotation, deploy rollback) are Next Server Actions that write the control DB / call the Vercel + Railway Mgmt clients already built in `infrastructure/provisioning`. The six runbooks live in `docs/runbooks/` as Markdown next to the existing `stripe-webhook-pileup.md`. The welcome email becomes a real branded template in `apps/workers/src/provisioning/notify.ts`; MCP usage docs are Markdown in `docs/`. E4/E5 ship as a single USER-ACTIONABLE go-live checklist doc plus agent-automatable Stripe **test-mode** scaffolding and landing-page code only.

**Tech Stack:** Next.js 16 App Router (server components + Server Actions, `apps/control`), `@realreal/control-db` (Supabase service-role client, typed queries, aes-256-gcm crypto, bcryptjs), `@realreal/provisioning` Mgmt clients (Vercel rollback, Railway redeploy), Node 20 + TypeScript (CommonJS, `apps/workers`), Resend HTTP API, `vitest@4` + `@testing-library`, Markdown runbooks/docs, GitHub Actions (extend `deploy-production-fanout.yml`).

---

## Required reading before starting

- `apps/web/AGENTS.md` and `apps/control/AGENTS.md` — **"This is NOT the Next.js you know."** Phase E edits `apps/control` (Next 16). Before writing any `apps/control` code, read the relevant guide in `apps/control/node_modules/next/dist/docs/` (Server Actions, `revalidatePath`, route segment conventions). Do not assume training-data Next.js.
- Spec sections, read with
  `git show origin/spec/multi-tenant-foundation:docs/superpowers/specs/2026-05-10-multi-tenant-platform-foundation-design.md`:
  - §4 — control DB schema, the **9 dashboard pages** (`/`, `/tenants`, `/tenants/[id]`, `/tenants/[id]/provision`, `/tenants/[id]/suspend`, `/tenants/[id]/audit`, `/jobs`, `/audit`, `/billing`), `apps/workers` cron list.
  - §6 — provisioning steps, retry ladder, **rollback** ("Not automatic … Retry from this step / Destroy").
  - §7 — branch model, `deploy-production-fanout.yml` incl. the **`monitor`** job (5-min poll, 3-consecutive-failure → email + Vercel rollback) that Phase D deferred to Phase E.
  - §8 — MCP bearer-token model, **"Token rotation in v1 is performed by the platform admin via the control plane dashboard."**
  - §9 — alert ladder, **KPIs visible on the dashboard home** (the exact list E1 must render), and the **six runbooks (lines 738–743)** that "must exist before GA".
  - §11 — Phase E lines 893–899 (E1–E5); the **"Validation criteria for migration complete"** checklist (lines 916–923) incl. "Six runbooks present in `docs/runbooks/`".
  - §12 open questions (Slack webhook, Stripe price IDs, Resend quota, KEK cadence, onboarding docs) — several are E-blocking USER-ACTIONABLE items; surface them, do not silently resolve.
  - §13 out-of-scope — **customer self-service MCP token rotation UI is OUT** (E only ships the *platform-admin* rotation action), Stripe plan up/down-grade OUT, fully-unattended BYO domain OUT.
- Current merged state to extend (do **not** rewrite):
  - `apps/control/src/app/page.tsx` (3-stat overview — must become the §9 KPI home), `tenants/page.tsx` (flat list — needs filter+search), `tenants/[id]/page.tsx` (read-only detail), `jobs/page.tsx`, `audit/page.tsx`, `src/components/nav.tsx`, `src/lib/{auth,control-db,format}.ts`.
  - `apps/workers/src/provisioning/notify.ts` (`sendWelcomeEmail` is a plaintext stub; `alertOps` Slack helper exists), `src/cron/health-check.ts`, `scripts/fanout-deploy.ts`, `.github/workflows/deploy-production-fanout.yml` (Phase D shipped canary→migrations→promote; **`monitor` is missing**).
  - `apps/mcp/src/index.ts` (health route is **`/health`**, not `/healthz` — see §"Spec ambiguities"), `apps/mcp/src/server.ts` (7 tools registered).
  - `docs/runbooks/stripe-webhook-pileup.md` (the established runbook tone/structure to mirror), `docs/runbooks/platform-deployment.md`, `docs/runbooks/phase-b-deployment.md`.
- Phase D plan tail (`docs/superpowers/plans/2026-05-15-phase-d-provisioning-pipeline.md`, Self-Review): it explicitly states **`monitor`/auto-rollback deferred to Phase E** and that the `/jobs` "Retry from this step" admin UI is **not built** (Phase E owns it).

## Conventions (match the existing codebase)

- `apps/control`: server components by default; mutations are Server Actions in a `actions.ts` colocated with the route, guarded by `requirePlatformUser()` (existing in `src/lib/auth.ts`) as the **first line**, then `revalidatePath(...)`. Tailwind utility classes, shadcn `ui/*` components already vendored. Dates via `fmtDate`, status via `statusColor` (`src/lib/format.ts`).
- `apps/workers`: `pino({ name: "<component>" })`, throw `Error` with a clear message, `fetch` + `AbortSignal.timeout`, never live network in unit tests (`vi.stubGlobal("fetch", …)`).
- Tests: `vitest run` from the package dir; `describe/it/expect`; mock all network. `apps/control` tests use the existing `src/test-setup.ts`.
- Runbooks/docs: mirror `docs/runbooks/stripe-webhook-pileup.md` — Symptom → Diagnose (copy-pasteable `bash`/`sql`) → Resolve → Escalate, with explicit **USER-ACTIONABLE** call-outs for anything needing a real dashboard/secret/financial action.
- Commits: Conventional Commits, scoped. Each task = one independently-mergeable PR off `main` named `feat/phase-eN-<slug>` (matches Phase A/B/C/D `feat/phase-bN-…` / `feat/phase-d-pr-dN` cadence). Never push to `main` or `production`; feature branch + `gh pr create` every time. Every commit ends with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- **Phase E ships zero live financial or DNS actions.** Stripe is **test-mode scaffolding only**; live keys, domain cutover, and the first paying customer are USER-ACTIONABLE (PR-E7).

## Agent-automatable vs USER-ACTIONABLE (read first)

| PR | Title | Nature |
|---|---|---|
| PR-E1 | Dashboard KPI home + tenant filter/search | **Agent-automatable** |
| PR-E2 | Provisioning retry + tenant suspend/resume actions | **Agent-automatable** |
| PR-E3 | Billing page + tenant-scoped audit + MCP token rotation action | **Agent-automatable** |
| PR-E4 | Deploy `monitor` job + auto-rollback (spec §7 deferred item) | **Agent-automatable** |
| PR-E5 | The six GA runbooks (`docs/runbooks/`) | **Agent-automatable** |
| PR-E6 | Branded welcome email + MCP usage docs (E3) | **Agent-automatable** |
| PR-E7 | GA go-live: Stripe **test-mode** scaffolding + landing page code + **USER-ACTIONABLE** E4/E5 cutover checklist | **Mixed** — code is agent-automatable; DNS cutover, Stripe **live** keys/activation, production-domain flip, onboarding a real paying tenant are **USER-ACTIONABLE** and explicitly NOT performed by any agent |

> **Hard rule for the implementing agent:** you implement code and write checklists. You do **not** create Stripe live keys, do **not** flip Stripe to live mode, do **not** edit Cloudflare/Vercel production DNS for `realreal.cc` or `platform.realreal.cc`, and do **not** onboard a real paying customer. Those are PR-E7's USER-ACTIONABLE section, performed by the human operator.

## File map (created/modified across all PRs)

```
apps/control/src/
  app/page.tsx                              MOD  3-stat → full §9 KPI home
  lib/kpi.ts                                NEW  KPI aggregation queries (testable, pure-ish)
  lib/__tests__/kpi.test.ts                 NEW
  app/tenants/page.tsx                      MOD  status filter + slug search (searchParams)
  lib/tenant-filter.ts                      NEW  parse/validate filter+search params
  lib/__tests__/tenant-filter.test.ts       NEW
  app/tenants/[id]/provision/page.tsx       NEW  per-step provisioning inspector + retry
  app/tenants/[id]/provision/actions.ts     NEW  retryProvisioningStep server action
  app/tenants/[id]/suspend/page.tsx         NEW  suspend/resume confirm screen
  app/tenants/[id]/suspend/actions.ts       NEW  suspendTenant/resumeTenant server actions
  app/tenants/[id]/audit/page.tsx           NEW  tenant-scoped audit_log
  app/billing/page.tsx                      NEW  billing_subscriptions view
  app/tenants/[id]/token/actions.ts         NEW  rotateMcpToken server action (spec §8)
  components/nav.tsx                         MOD  add Billing link
  lib/__tests__/actions-guard.test.ts        NEW  every action calls requirePlatformUser first
packages/control-db/src/queries/
  jobs.ts                                   MOD  requeueStep(client, tenantId, step)  (idempotent re-queue)
  tenants.ts                                MOD  setTenantStatus suspend/resume helpers
  infrastructure.ts                         MOD  setMcpTokenHash(client, tenantId, hash, kek)
apps/workers/
  src/provisioning/notify.ts                MOD  sendWelcomeEmail → branded HTML+text template
  __tests__/notify-welcome.test.ts          NEW
  src/cron/deploy-monitor.ts                NEW  spec §7 monitor: 5-min poll, 3-streak → rollback+email
  __tests__/deploy-monitor.test.ts          NEW
scripts/
  rollback-tenant.ts                        NEW  Vercel rollback + Railway redeploy-prev (used by monitor + runbook)
  __tests__/rollback-tenant.test.ts         NEW
.github/workflows/deploy-production-fanout.yml  MOD  append `monitor` job (1-hour watch)
apps/web/src/app/(marketing)/buy/page.tsx   NEW  landing/pricing page (Stripe test-mode Checkout link)
apps/web/src/app/(marketing)/buy/__tests__/buy.test.tsx  NEW
docs/runbooks/
  tenant-down.md                            NEW  §9 runbook 1
  supabase-quota-hit.md                     NEW  §9 runbook 3
  accidental-data-delete.md                 NEW  §9 runbook 4
  mcp-token-leak.md                         NEW  §9 runbook 5
  code-deploy-broke-everyone.md             NEW  §9 runbook 6
  kek-rotation.md                           NEW  §4/§12 KEK rotation (referenced by mcp-token-leak)
docs/
  customer-welcome-email.md                 NEW  the welcome-email copy of record (E3)
  mcp-usage.md                              NEW  customer MCP connection + tool catalog (E3)
  ga-go-live-checklist.md                   NEW  USER-ACTIONABLE E4 (DNS) + E5 (Stripe live, paying tenant)
```

> **The six runbooks (E2 / spec §9 lines 738–743), reconciled with §12:** the spec enumerates them *exactly*: `tenant-down.md`, `stripe-webhook-pileup.md`, `supabase-quota-hit.md`, `accidental-data-delete.md`, `mcp-token-leak.md`, `code-deploy-broke-everyone.md`. `stripe-webhook-pileup.md` already shipped in Phase D, so Phase E writes the **other five**. The task brief also names "KEK rotation" — §4 says `PLATFORM_KEK` rotation "is a manual procedure documented in a runbook" and §12 Q4 sets its cadence; that content is required but is *not one of the canonical six*. We ship it as `kek-rotation.md`, owned by and cross-linked from `mcp-token-leak.md` (token-leak response includes "rotate the KEK if the service-role key may be exposed"), so the GA validation criterion "Six runbooks present in `docs/runbooks/`" is met by the exact six the spec names while KEK rotation is fully documented.

---

## PR-E1: Dashboard KPI home + tenant filter/search

**Why first:** the §9 KPI home and a filterable tenant list are the operator's primary GA surface and have zero new infra; everything else (retry, suspend, monitor, runbooks) references them. Pure read.

**Files:**
- Create: `apps/control/src/lib/kpi.ts`
- Test: `apps/control/src/lib/__tests__/kpi.test.ts`
- Modify: `apps/control/src/app/page.tsx`
- Create: `apps/control/src/lib/tenant-filter.ts`
- Test: `apps/control/src/lib/__tests__/tenant-filter.test.ts`
- Modify: `apps/control/src/app/tenants/page.tsx`

- [ ] **Step 1: Write the failing test for the filter parser**

```ts
// apps/control/src/lib/__tests__/tenant-filter.test.ts
import { describe, it, expect } from "vitest"
import { parseTenantFilter, TENANT_STATUSES } from "../tenant-filter"

describe("parseTenantFilter", () => {
  it("defaults to no filter, empty search", () => {
    expect(parseTenantFilter({})).toEqual({ status: null, q: "" })
  })
  it("accepts a valid status and trims/normalizes the query", () => {
    expect(parseTenantFilter({ status: "active", q: "  Real " }))
      .toEqual({ status: "active", q: "real" })
  })
  it("rejects an unknown status (treats as no filter)", () => {
    expect(parseTenantFilter({ status: "bogus" })).toEqual({ status: null, q: "" })
  })
  it("exposes the canonical status list", () => {
    expect(TENANT_STATUSES).toEqual([
      "pending_payment", "provisioning", "active", "suspended", "canceled", "failed",
    ])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/control && npx vitest run src/lib/__tests__/tenant-filter.test.ts`
Expected: FAIL — `Cannot find module '../tenant-filter'`.

- [ ] **Step 3: Implement the filter parser**

```ts
// apps/control/src/lib/tenant-filter.ts
export const TENANT_STATUSES = [
  "pending_payment", "provisioning", "active", "suspended", "canceled", "failed",
] as const
export type TenantStatus = (typeof TENANT_STATUSES)[number]

export interface TenantFilter {
  status: TenantStatus | null
  q: string
}

// searchParams values arrive as string | string[] | undefined
export function parseTenantFilter(
  sp: Record<string, string | string[] | undefined>,
): TenantFilter {
  const rawStatus = Array.isArray(sp.status) ? sp.status[0] : sp.status
  const rawQ = Array.isArray(sp.q) ? sp.q[0] : sp.q
  const status = (TENANT_STATUSES as readonly string[]).includes(rawStatus ?? "")
    ? (rawStatus as TenantStatus)
    : null
  return { status, q: (rawQ ?? "").trim().toLowerCase() }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd apps/control && npx vitest run src/lib/__tests__/tenant-filter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for KPI aggregation**

```ts
// apps/control/src/lib/__tests__/kpi.test.ts
import { describe, it, expect } from "vitest"
import { computeKpis } from "../kpi"

describe("computeKpis", () => {
  it("derives the spec §9 home KPIs from raw rows", () => {
    const out = computeKpis({
      activeTenants: 4,
      provisioningDurationsSec: [300, 360, 420, 999, 480], // p95 of 5 = the 5th smallest-ish
      tenant5xxLastHour: [{ tenant_id: "a", count: 2 }, { tenant_id: "b", count: 0 }],
      mcpCallsLastHour: [{ tenant_id: "a", total: 120, errors: 6 }],
      healthStreaks: [{ tenant_id: "a", failure_streak: 0 }, { tenant_id: "b", failure_streak: 3 }],
    })
    expect(out.tenant_count_active).toBe(4)
    expect(out.provisioning_p95_seconds).toBe(999)
    expect(out.tenant_5xx_total_last_hour).toBe(2)
    expect(out.mcp_tool_call_count_last_hour).toBe(120)
    expect(out.mcp_tool_call_error_rate).toBeCloseTo(0.05, 5)
    expect(out.max_health_failure_streak).toBe(3)
  })
  it("is safe on empty inputs (no NaN)", () => {
    const out = computeKpis({
      activeTenants: 0, provisioningDurationsSec: [],
      tenant5xxLastHour: [], mcpCallsLastHour: [], healthStreaks: [],
    })
    expect(out.provisioning_p95_seconds).toBe(0)
    expect(out.mcp_tool_call_error_rate).toBe(0)
  })
})
```

- [ ] **Step 6: Run test, verify it fails**

Run: `cd apps/control && npx vitest run src/lib/__tests__/kpi.test.ts`
Expected: FAIL — `Cannot find module '../kpi'`.

- [ ] **Step 7: Implement the KPI aggregator**

```ts
// apps/control/src/lib/kpi.ts
// Spec §9 "KPIs visible on the dashboard home". Pure function over already
// fetched rows so it is unit-testable without a DB.
export interface KpiInput {
  activeTenants: number
  provisioningDurationsSec: number[]
  tenant5xxLastHour: { tenant_id: string; count: number }[]
  mcpCallsLastHour: { tenant_id: string; total: number; errors: number }[]
  healthStreaks: { tenant_id: string; failure_streak: number }[]
}
export interface Kpis {
  tenant_count_active: number
  provisioning_p95_seconds: number
  tenant_5xx_total_last_hour: number
  mcp_tool_call_count_last_hour: number
  mcp_tool_call_error_rate: number
  max_health_failure_streak: number
}

function p95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.min(idx, sorted.length - 1)]
}

export function computeKpis(i: KpiInput): Kpis {
  const totalCalls = i.mcpCallsLastHour.reduce((s, r) => s + r.total, 0)
  const totalErr = i.mcpCallsLastHour.reduce((s, r) => s + r.errors, 0)
  return {
    tenant_count_active: i.activeTenants,
    provisioning_p95_seconds: p95(i.provisioningDurationsSec),
    tenant_5xx_total_last_hour: i.tenant5xxLastHour.reduce((s, r) => s + r.count, 0),
    mcp_tool_call_count_last_hour: totalCalls,
    mcp_tool_call_error_rate: totalCalls === 0 ? 0 : totalErr / totalCalls,
    max_health_failure_streak: i.healthStreaks.reduce(
      (m, r) => Math.max(m, r.failure_streak), 0),
  }
}
```

- [ ] **Step 8: Run test, verify it passes**

Run: `cd apps/control && npx vitest run src/lib/__tests__/kpi.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Wire the KPI home page**

Replace `apps/control/src/app/page.tsx` with (reads health-streak from `tenant_health_log`, durations from `provisioning_jobs` finished `tenant_finalize` minus first job, calls from `audit_log` actor_type `customer_agent`; degrade gracefully if a table is empty):

```tsx
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { computeKpis } from "@/lib/kpi"

export const metadata = { title: "Platform Control" }

export default async function HomePage() {
  await requirePlatformUser()
  const supabase = await createControlClient()

  const since = new Date(Date.now() - 3600_000).toISOString()
  const since30d = new Date(Date.now() - 30 * 86400_000).toISOString()

  const [active, finals, health, mcp] = await Promise.all([
    supabase.from("tenants").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("provisioning_jobs")
      .select("tenant_id, started_at, finished_at")
      .eq("step", "tenant_finalize").eq("status", "success")
      .gte("finished_at", since30d),
    supabase.from("tenant_health_log")
      .select("tenant_id, vercel_ok, api_ok, mcp_ok, supabase_ok, checked_at")
      .gte("checked_at", since).order("checked_at", { ascending: false }),
    supabase.from("audit_log")
      .select("tenant_id, action")
      .eq("actor_type", "customer_agent").gte("created_at", since),
  ])

  const durations = (finals.data ?? [])
    .filter(r => r.started_at && r.finished_at)
    .map(r => (Date.parse(r.finished_at!) - Date.parse(r.started_at!)) / 1000)

  // streak = consecutive most-recent non-ok per tenant
  const streakByTenant = new Map<string, number>()
  for (const h of health.data ?? []) {
    const ok = h.vercel_ok && h.api_ok && h.mcp_ok && h.supabase_ok
    if (streakByTenant.get(h.tenant_id) === -1) continue
    if (!ok) streakByTenant.set(h.tenant_id, (streakByTenant.get(h.tenant_id) ?? 0) + 1)
    else streakByTenant.set(h.tenant_id, -1)
  }
  const healthStreaks = [...streakByTenant].map(([tenant_id, s]) =>
    ({ tenant_id, failure_streak: s === -1 ? 0 : s }))

  const callsByTenant = new Map<string, { total: number; errors: number }>()
  for (const a of mcp.data ?? []) {
    const cur = callsByTenant.get(a.tenant_id ?? "?") ?? { total: 0, errors: 0 }
    cur.total += 1
    if (a.action?.endsWith(".error")) cur.errors += 1
    callsByTenant.set(a.tenant_id ?? "?", cur)
  }

  const kpis = computeKpis({
    activeTenants: active.count ?? 0,
    provisioningDurationsSec: durations,
    tenant5xxLastHour: [],
    mcpCallsLastHour: [...callsByTenant].map(([tenant_id, v]) => ({ tenant_id, ...v })),
    healthStreaks,
  })

  const cards: [string, string | number, boolean][] = [
    ["Active tenants", kpis.tenant_count_active, false],
    ["Provisioning p95 (30d)", `${Math.round(kpis.provisioning_p95_seconds)}s`, false],
    ["MCP calls (1h)", kpis.mcp_tool_call_count_last_hour, false],
    ["MCP error rate (1h)", `${(kpis.mcp_tool_call_error_rate * 100).toFixed(1)}%`,
      kpis.mcp_tool_call_error_rate > 0.1],
    ["Max health-fail streak", kpis.max_health_failure_streak,
      kpis.max_health_failure_streak >= 3],
  ]

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>
      <div className="grid grid-cols-3 gap-4">
        {cards.map(([label, value, danger]) => (
          <div key={label} className="border rounded p-4">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className={`text-2xl font-semibold ${danger ? "text-red-600" : "text-foreground"}`}>
              {value}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 10: Add status filter + slug search to `/tenants`**

Replace `apps/control/src/app/tenants/page.tsx` with a server component that reads `searchParams`, applies `parseTenantFilter`, and renders a `<form method="get">` with a `<select name="status">` (options from `TENANT_STATUSES`) + `<input name="q">`, then queries `tenants` with `.eq("status", …)` when set and `.ilike("slug", "%"+q+"%")` when `q` non-empty:

```tsx
import Link from "next/link"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"
import { parseTenantFilter, TENANT_STATUSES } from "@/lib/tenant-filter"

export const metadata = { title: "Tenants | Platform Control" }

export default async function TenantsPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requirePlatformUser()
  const f = parseTenantFilter(await searchParams)
  const supabase = await createControlClient()

  let q = supabase.from("tenants")
    .select("id, slug, custom_domain, status, created_at, activated_at")
    .order("created_at", { ascending: false }).limit(200)
  if (f.status) q = q.eq("status", f.status)
  if (f.q) q = q.ilike("slug", `%${f.q}%`)
  const { data } = await q

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Tenants</h1>
      <form method="get" className="flex gap-2 text-sm">
        <select name="status" defaultValue={f.status ?? ""} className="border rounded px-2 py-1">
          <option value="">all statuses</option>
          {TENANT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input name="q" defaultValue={f.q} placeholder="slug…"
          className="border rounded px-2 py-1" />
        <button className="border rounded px-3 py-1">Filter</button>
      </form>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">Slug</th><th>Domain</th><th>Status</th><th>Created</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map(t => (
            <tr key={t.id} className="border-t">
              <td className="py-2">
                <Link className="underline" href={`/tenants/${t.id}`}>{t.slug}</Link>
              </td>
              <td>{t.custom_domain ?? "—"}</td>
              <td className={statusColor(t.status)}>{t.status}</td>
              <td>{fmtDate(t.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
```

- [ ] **Step 11: Run full control test suite + typecheck**

Run: `cd apps/control && npx vitest run && npx tsc --noEmit`
Expected: PASS — all `kpi`/`tenant-filter` tests green, no TS errors. (If `apps/control` has no `tsc` script, run `npx tsc -p tsconfig.json --noEmit`.)

- [ ] **Step 12: Commit**

```bash
git add apps/control/src/lib/kpi.ts apps/control/src/lib/tenant-filter.ts apps/control/src/lib/__tests__/kpi.test.ts apps/control/src/lib/__tests__/tenant-filter.test.ts apps/control/src/app/page.tsx apps/control/src/app/tenants/page.tsx
git commit -m "$(cat <<'EOF'
feat(control): KPI home + tenant filter/search (Phase E1)

Renders the spec §9 dashboard-home KPIs and adds status filter + slug
search to /tenants. Aggregation logic is a pure, unit-tested helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-E2: Provisioning retry + tenant suspend/resume actions

**Why second:** spec §6 "Retry from this step" / §9 incident response and the tenant-down runbook (PR-E5) depend on these control-plane actions existing. Phase D's runbook explicitly notes this UI is unbuilt and owned by Phase E.

**Files:**
- Modify: `packages/control-db/src/queries/jobs.ts`
- Modify: `packages/control-db/src/queries/tenants.ts`
- Create: `apps/control/src/app/tenants/[id]/provision/page.tsx`
- Create: `apps/control/src/app/tenants/[id]/provision/actions.ts`
- Create: `apps/control/src/app/tenants/[id]/suspend/page.tsx`
- Create: `apps/control/src/app/tenants/[id]/suspend/actions.ts`
- Test: `packages/control-db/src/queries/__tests__/jobs-requeue.test.ts`
- Test: `apps/control/src/lib/__tests__/actions-guard.test.ts`

- [ ] **Step 1: Write the failing test for `requeueStep`**

```ts
// packages/control-db/src/queries/__tests__/jobs-requeue.test.ts
import { describe, it, expect, vi } from "vitest"
import { requeueStep } from "../jobs"

function fakeClient(captured: { table?: string; patch?: unknown; eqs: [string, unknown][] }) {
  const builder: any = {
    update(p: unknown) { captured.patch = p; return builder },
    eq(col: string, val: unknown) { captured.eqs.push([col, val]); return builder },
    then(res: (v: { error: null }) => void) { res({ error: null }) },
  }
  return { from(t: string) { captured.table = t; return builder } } as any
}

describe("requeueStep", () => {
  it("re-queues exactly the one (tenant, step) job with attempt reset", async () => {
    const cap = { eqs: [] as [string, unknown][] } as any
    await requeueStep(fakeClient(cap), "ten-1", "vercel_setup")
    expect(cap.table).toBe("provisioning_jobs")
    expect(cap.patch).toMatchObject({
      status: "queued", attempt: 0, last_error: null, started_at: null,
    })
    expect(cap.eqs).toContainEqual(["tenant_id", "ten-1"])
    expect(cap.eqs).toContainEqual(["step", "vercel_setup"])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd packages/control-db && npx vitest run src/queries/__tests__/jobs-requeue.test.ts`
Expected: FAIL — `requeueStep` is not exported.

- [ ] **Step 3: Implement `requeueStep` + tenant status helpers**

Append to `packages/control-db/src/queries/jobs.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

// Idempotent re-queue of a single provisioning step (spec §6 "Retry from this
// step"). Mirrors the stuck-sweep / Phase-D runbook SQL exactly: reset attempt,
// clear error, make immediately claimable. Handlers' isComplete() makes replay
// safe. If your jobs table has `available_at`, also set it to now().
export async function requeueStep(
  client: SupabaseClient, tenantId: string, step: string,
): Promise<void> {
  const { error } = await client.from("provisioning_jobs")
    .update({
      status: "queued", attempt: 0, last_error: null,
      started_at: null, available_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId).eq("step", step)
  if (error) throw new Error(`requeueStep(${tenantId},${step}): ${error.message}`)
}
```

Append to `packages/control-db/src/queries/tenants.ts`:

```ts
// Spec §9 tenant cancellation/suspension. Suspend freezes; resume restores to
// active. Data is preserved (no infra teardown here — that is the §9 30-day
// cron, out of Phase E scope).
export async function suspendTenant(
  client: SupabaseClient, tenantId: string, reason: string,
): Promise<void> {
  const { error } = await client.from("tenants").update({
    status: "suspended", suspended_at: new Date().toISOString(),
    suspended_reason: reason,
  }).eq("id", tenantId)
  if (error) throw new Error(`suspendTenant(${tenantId}): ${error.message}`)
}

export async function resumeTenant(
  client: SupabaseClient, tenantId: string,
): Promise<void> {
  const { error } = await client.from("tenants").update({
    status: "active", suspended_at: null, suspended_reason: null,
  }).eq("id", tenantId)
  if (error) throw new Error(`resumeTenant(${tenantId}): ${error.message}`)
}
```

> If `jobs.ts`/`tenants.ts` already import `SupabaseClient`, do not re-import; reuse the existing import.

- [ ] **Step 4: Run test, verify it passes**

Run: `cd packages/control-db && npx vitest run src/queries/__tests__/jobs-requeue.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Implement the provision inspector page + retry action**

`apps/control/src/app/tenants/[id]/provision/actions.ts`:

```ts
"use server"
import { revalidatePath } from "next/cache"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { requeueStep } from "@realreal/control-db"

export async function retryProvisioningStep(formData: FormData): Promise<void> {
  await requirePlatformUser()                       // guard FIRST
  const tenantId = String(formData.get("tenantId"))
  const step = String(formData.get("step"))
  if (!tenantId || !step) throw new Error("tenantId and step required")
  const supabase = await createControlClient()
  await requeueStep(supabase, tenantId, step)
  // also un-stick the tenant row so the running pipeline can finish
  await supabase.from("tenants").update({ status: "provisioning" })
    .eq("id", tenantId).eq("status", "failed")
  revalidatePath(`/tenants/${tenantId}/provision`)
}
```

`apps/control/src/app/tenants/[id]/provision/page.tsx`:

```tsx
import { notFound } from "next/navigation"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"
import { retryProvisioningStep } from "./actions"

export default async function ProvisionPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data: tenant } = await supabase.from("tenants")
    .select("id, slug, status").eq("id", id).maybeSingle()
  if (!tenant) notFound()
  const { data: jobs } = await supabase.from("provisioning_jobs")
    .select("step, status, attempt, last_error, started_at, finished_at")
    .eq("tenant_id", id).order("created_at")

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">{tenant.slug} — provisioning</h1>
      <p className={`text-sm ${statusColor(tenant.status)}`}>{tenant.status}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-1">Step</th><th>Status</th><th>Attempt</th><th>Finished</th><th>Error</th><th></th></tr>
        </thead>
        <tbody>
          {(jobs ?? []).map(j => (
            <tr key={j.step} className="border-t align-top">
              <td className="py-1">{j.step}</td>
              <td className={statusColor(j.status)}>{j.status}</td>
              <td>{j.attempt}</td>
              <td>{fmtDate(j.finished_at)}</td>
              <td className="max-w-xs truncate text-red-600" title={j.last_error ?? ""}>{j.last_error ?? ""}</td>
              <td>
                {j.status === "failed" && (
                  <form action={retryProvisioningStep}>
                    <input type="hidden" name="tenantId" value={id} />
                    <input type="hidden" name="step" value={j.step} />
                    <button className="border rounded px-2 py-0.5">Retry from this step</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
```

- [ ] **Step 6: Implement suspend/resume page + actions**

`apps/control/src/app/tenants/[id]/suspend/actions.ts`:

```ts
"use server"
import { revalidatePath } from "next/cache"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { suspendTenant, resumeTenant } from "@realreal/control-db"

export async function suspendTenantAction(formData: FormData): Promise<void> {
  await requirePlatformUser()
  const id = String(formData.get("tenantId"))
  const reason = String(formData.get("reason") || "manual suspend (control plane)")
  await suspendTenant(await createControlClient(), id, reason)
  revalidatePath(`/tenants/${id}`)
  revalidatePath(`/tenants/${id}/suspend`)
}

export async function resumeTenantAction(formData: FormData): Promise<void> {
  await requirePlatformUser()
  const id = String(formData.get("tenantId"))
  await resumeTenant(await createControlClient(), id)
  revalidatePath(`/tenants/${id}`)
  revalidatePath(`/tenants/${id}/suspend`)
}
```

`apps/control/src/app/tenants/[id]/suspend/page.tsx`:

```tsx
import { notFound } from "next/navigation"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { statusColor } from "@/lib/format"
import { suspendTenantAction, resumeTenantAction } from "./actions"

export default async function SuspendPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data: t } = await supabase.from("tenants")
    .select("id, slug, status, suspended_reason").eq("id", id).maybeSingle()
  if (!t) notFound()
  const suspended = t.status === "suspended"

  return (
    <main className="p-8 space-y-4 max-w-lg">
      <h1 className="text-xl font-semibold">{t.slug}</h1>
      <p className={`text-sm ${statusColor(t.status)}`}>{t.status}</p>
      {suspended ? (
        <form action={resumeTenantAction} className="space-y-2">
          <input type="hidden" name="tenantId" value={id} />
          <p className="text-sm text-muted-foreground">
            Reason on file: {t.suspended_reason ?? "—"}
          </p>
          <button className="border rounded px-3 py-1">Resume tenant</button>
        </form>
      ) : (
        <form action={suspendTenantAction} className="space-y-2">
          <input type="hidden" name="tenantId" value={id} />
          <textarea name="reason" required placeholder="suspension reason"
            className="border rounded w-full p-2 text-sm" />
          <button className="border rounded px-3 py-1 text-red-600">Suspend tenant</button>
        </form>
      )}
    </main>
  )
}
```

- [ ] **Step 7: Write the actions-guard test (every action calls `requirePlatformUser` first)**

```ts
// apps/control/src/lib/__tests__/actions-guard.test.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { globSync } from "node:fs"

const files = [
  "src/app/tenants/[id]/provision/actions.ts",
  "src/app/tenants/[id]/suspend/actions.ts",
]

describe("server actions are auth-guarded", () => {
  it.each(files)("%s calls requirePlatformUser before any DB write", (rel) => {
    const src = readFileSync(rel, "utf8")
    // every exported async action must await requirePlatformUser() before
    // createControlClient() / any query helper
    const guardIdx = src.indexOf("await requirePlatformUser()")
    const clientIdx = src.indexOf("createControlClient(")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(clientIdx)
  })
})
```

> If `globSync` is unavailable in the Node version, drop the unused import; the test uses a static file list.

- [ ] **Step 8: Run test, verify it fails then passes**

Run: `cd apps/control && npx vitest run src/lib/__tests__/actions-guard.test.ts`
Expected: PASS (the actions written in Steps 5–6 already place the guard first). If it FAILS, the guard ordering is wrong — fix the action, do not weaken the test.

- [ ] **Step 9: Full suite + typecheck**

Run: `cd apps/control && npx vitest run && npx tsc --noEmit && cd ../../packages/control-db && npx vitest run`
Expected: PASS across all.

- [ ] **Step 10: Commit**

```bash
git add packages/control-db/src/queries/jobs.ts packages/control-db/src/queries/tenants.ts packages/control-db/src/queries/__tests__/jobs-requeue.test.ts "apps/control/src/app/tenants/[id]/provision" "apps/control/src/app/tenants/[id]/suspend" apps/control/src/lib/__tests__/actions-guard.test.ts
git commit -m "$(cat <<'EOF'
feat(control): retry-provisioning + suspend/resume actions (Phase E1)

Adds the spec §6 "Retry from this step" inspector and §9 suspend/resume
control surface. Server actions are auth-guarded; DB helpers are unit tested.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-E3: Billing page + tenant audit + MCP token rotation action

**Why third:** completes the spec §4 nine-page set (`/billing`, `/tenants/[id]/audit`) and the spec §8 platform-admin MCP token rotation (explicitly the *platform-admin* action — customer self-service rotation UI is §13 out-of-scope).

**Files:**
- Modify: `packages/control-db/src/queries/infrastructure.ts`
- Create: `apps/control/src/app/billing/page.tsx`
- Create: `apps/control/src/app/tenants/[id]/audit/page.tsx`
- Create: `apps/control/src/app/tenants/[id]/token/actions.ts`
- Modify: `apps/control/src/components/nav.tsx`
- Test: `packages/control-db/src/queries/__tests__/set-mcp-token.test.ts`

- [ ] **Step 1: Failing test for `setMcpTokenHash`**

```ts
// packages/control-db/src/queries/__tests__/set-mcp-token.test.ts
import { describe, it, expect } from "vitest"
import bcrypt from "bcryptjs"
import { hashMcpToken } from "../infrastructure"

describe("hashMcpToken", () => {
  it("produces a bcrypt hash that verifies the plaintext and is not the plaintext", async () => {
    const { token, hash } = await hashMcpToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)        // 32 random bytes hex
    expect(hash).not.toBe(token)
    expect(await bcrypt.compare(token, hash)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd packages/control-db && npx vitest run src/queries/__tests__/set-mcp-token.test.ts`
Expected: FAIL — `hashMcpToken` not exported.

- [ ] **Step 3: Implement `hashMcpToken` + `setMcpTokenHash`**

Append to `packages/control-db/src/queries/infrastructure.ts`:

```ts
import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import type { SupabaseClient } from "@supabase/supabase-js"

// Spec §8: one long-lived bearer token per tenant; only its bcrypt hash is
// persisted. Plaintext is shown to the operator exactly once (to relay to the
// customer). Mirrors apps/workers/src/provisioning/steps/tenant-finalize.ts.
export async function hashMcpToken(): Promise<{ token: string; hash: string }> {
  const token = randomBytes(32).toString("hex")
  const hash = await bcrypt.hash(token, 10)
  return { token, hash }
}

export async function setMcpTokenHash(
  client: SupabaseClient, tenantId: string, hash: string,
): Promise<void> {
  const { error } = await client.from("tenant_infrastructure")
    .update({ mcp_token_hash: hash }).eq("tenant_id", tenantId)
  if (error) throw new Error(`setMcpTokenHash(${tenantId}): ${error.message}`)
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd packages/control-db && npx vitest run src/queries/__tests__/set-mcp-token.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Token rotation server action**

`apps/control/src/app/tenants/[id]/token/actions.ts`:

```ts
"use server"
import { revalidatePath } from "next/cache"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { hashMcpToken, setMcpTokenHash } from "@realreal/control-db"

// Returns the new plaintext token ONCE to the operator. Spec §8 — platform
// admin rotation only (customer self-service UI is §13 out of scope).
export async function rotateMcpToken(formData: FormData): Promise<string> {
  await requirePlatformUser()
  const tenantId = String(formData.get("tenantId"))
  if (!tenantId) throw new Error("tenantId required")
  const { token, hash } = await hashMcpToken()
  const supabase = await createControlClient()
  await setMcpTokenHash(supabase, tenantId, hash)
  await supabase.from("audit_log").insert({
    tenant_id: tenantId, actor_type: "platform_admin",
    action: "mcp_token.rotated", resource: "tenant_infrastructure",
  })
  revalidatePath(`/tenants/${tenantId}`)
  return token  // shown once; the MCP service picks up the new hash on next auth
}
```

> **Plan note for the engineer:** render this token in the tenant detail page (`tenants/[id]/page.tsx`) behind a "Rotate MCP token" `<form>` whose action stores the returned string in a `useActionState`-backed client component (`"use client"`) that displays it once with a "copy" affordance and a "this is shown once" warning. Add that small client island under a new `Modules` section neighbor; do not block the page render on it. Cross-link `docs/runbooks/mcp-token-leak.md` (PR-E5) here in a comment.

- [ ] **Step 6: Billing page**

`apps/control/src/app/billing/page.tsx`:

```tsx
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"

export const metadata = { title: "Billing | Platform Control" }

export default async function BillingPage() {
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data } = await supabase.from("billing_subscriptions")
    .select("id, tenant_id, status, plan, current_period_end, updated_at")
    .order("updated_at", { ascending: false }).limit(200)

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Billing</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">Subscription</th><th>Tenant</th><th>Plan</th><th>Status</th><th>Period end</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map(s => (
            <tr key={s.id} className="border-t">
              <td className="py-2 font-mono text-xs">{s.id}</td>
              <td className="font-mono text-xs">{s.tenant_id?.slice(0, 8) ?? "—"}</td>
              <td>{s.plan ?? "—"}</td>
              <td className={statusColor(s.status ?? "")}>{s.status ?? "—"}</td>
              <td>{fmtDate(s.current_period_end)}</td>
              <td>{fmtDate(s.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
```

- [ ] **Step 7: Tenant-scoped audit page**

`apps/control/src/app/tenants/[id]/audit/page.tsx`:

```tsx
import { notFound } from "next/navigation"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate } from "@/lib/format"

export default async function TenantAuditPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data: t } = await supabase.from("tenants")
    .select("slug").eq("id", id).maybeSingle()
  if (!t) notFound()
  const { data } = await supabase.from("audit_log")
    .select("created_at, actor_type, actor_id, action, resource")
    .eq("tenant_id", id).order("created_at", { ascending: false }).limit(200)

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">{t.slug} — audit</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">Time</th><th>Actor</th><th>Action</th><th>Resource</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((a, i) => (
            <tr key={i} className="border-t">
              <td className="py-2">{fmtDate(a.created_at)}</td>
              <td>{a.actor_type}{a.actor_id ? ` (${a.actor_id})` : ""}</td>
              <td>{a.action}</td>
              <td>{a.resource ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
```

- [ ] **Step 8: Add Billing to nav**

Modify `apps/control/src/components/nav.tsx` — add after the Audit link:

```tsx
      <Link href="/billing">Billing</Link>
```

(Final nav: Overview, Tenants, Jobs, Audit, Billing.)

- [ ] **Step 9: Full suite + typecheck**

Run: `cd packages/control-db && npx vitest run && cd ../../apps/control && npx vitest run && npx tsc --noEmit`
Expected: PASS across all.

- [ ] **Step 10: Commit**

```bash
git add packages/control-db/src/queries/infrastructure.ts packages/control-db/src/queries/__tests__/set-mcp-token.test.ts apps/control/src/app/billing "apps/control/src/app/tenants/[id]/audit" "apps/control/src/app/tenants/[id]/token" apps/control/src/components/nav.tsx
git commit -m "$(cat <<'EOF'
feat(control): billing page, tenant audit, MCP token rotation (Phase E1)

Completes the spec §4 nine-page dashboard set and the spec §8 platform-admin
MCP token rotation action (bcrypt-hashed; plaintext shown once).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-E4: Deploy `monitor` job + auto-rollback (spec §7 deferred item)

**Why fourth:** spec §7's `deploy-production-fanout.yml` ends with a `monitor` job (1-hour watch, 5-min poll, 3-consecutive-failure → email + Vercel rollback). Phase D's Self-Review **explicitly deferred this to Phase E**. It is the last automation gap before GA and the `code-deploy-broke-everyone.md` runbook (PR-E5) references it.

**Files:**
- Create: `scripts/rollback-tenant.ts`
- Test: `scripts/__tests__/rollback-tenant.test.ts`
- Create: `apps/workers/src/cron/deploy-monitor.ts`
- Test: `apps/workers/__tests__/deploy-monitor.test.ts`
- Modify: `.github/workflows/deploy-production-fanout.yml`

- [ ] **Step 1: Failing test for `rollback-tenant.ts`**

```ts
// scripts/__tests__/rollback-tenant.test.ts
import { describe, it, expect, vi, afterEach } from "vitest"
import { rollbackTenant } from "../rollback-tenant"

afterEach(() => vi.unstubAllGlobals())

describe("rollbackTenant", () => {
  it("calls Vercel rollback then Railway redeploy-previous with stored ids", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }))
    await rollbackTenant({
      vercelProjectId: "prj_1", railwayApiServiceId: "svc_1",
      vercelToken: "vt", railwayToken: "rt",
    })
    expect(calls.some(u => u.includes("vercel.com"))).toBe(true)
    expect(calls.some(u => u.includes("railway"))).toBe(true)
  })
  it("throws (non-zero) when Vercel rollback fails so the workflow fails loud", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("boom", { status: 500 })))
    await expect(rollbackTenant({
      vercelProjectId: "p", railwayApiServiceId: "s",
      vercelToken: "v", railwayToken: "r",
    })).rejects.toThrow(/rollback/i)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /Users/cataholic/.gemini/File/G && npx vitest run scripts/__tests__/rollback-tenant.test.ts`
Expected: FAIL — `Cannot find module '../rollback-tenant'`. (If the repo root has no vitest config, run from `apps/workers` after moving the test there; keep test+impl colocated under `scripts/__tests__` and add a `vitest.config.ts` at root with `test.include: ["scripts/__tests__/**/*.test.ts"]` if none exists — match how `scripts/provision-throwaway.ts` is tested in `apps/workers/__tests__/provision-throwaway.test.ts`; if that pattern is used, put this test in `apps/workers/__tests__/rollback-tenant.test.ts` instead and import via relative path `../../scripts/rollback-tenant`.)

- [ ] **Step 3: Implement `rollback-tenant.ts`**

```ts
// scripts/rollback-tenant.ts
// Roll a single tenant back to its previous good deploy. Used by the §7
// deploy `monitor` job (auto, on 3-streak failure) and manually from
// docs/runbooks/code-deploy-broke-everyone.md.
export interface RollbackArgs {
  vercelProjectId: string
  railwayApiServiceId: string
  vercelToken: string
  railwayToken: string
}

export async function rollbackTenant(a: RollbackArgs): Promise<void> {
  // 1. Vercel: promote the previous READY production deployment.
  const vRes = await fetch(
    `https://api.vercel.com/v9/projects/${a.vercelProjectId}/rollback`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${a.vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!vRes.ok) {
    throw new Error(`vercel rollback ${a.vercelProjectId}: ${vRes.status} ${await vRes.text()}`)
  }
  // 2. Railway: redeploy the previous successful deployment of the API service.
  const rRes = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${a.railwayToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation Rollback($sid: String!) {
        serviceInstanceRedeploy(serviceId: $sid) }`,
      variables: { sid: a.railwayApiServiceId },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!rRes.ok) {
    throw new Error(`railway redeploy ${a.railwayApiServiceId}: ${rRes.status} ${await rRes.text()}`)
  }
}
```

> The Vercel rollback endpoint shape may differ in the pinned API version; the engineer must confirm against `infrastructure/provisioning/clients/vercel.ts` (Phase D shipped a Vercel client — **reuse its rollback helper if one exists** and delete the inline `fetch` in favor of it; the test only pins behavior, not the transport). Same for Railway `clients/railway.ts`.

- [ ] **Step 4: Run test, verify it passes**

Run: `cd /Users/cataholic/.gemini/File/G && npx vitest run scripts/__tests__/rollback-tenant.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Failing test for the monitor cron**

```ts
// apps/workers/__tests__/deploy-monitor.test.ts
import { describe, it, expect, vi } from "vitest"
import { evaluateMonitorTick } from "../src/cron/deploy-monitor"

describe("evaluateMonitorTick", () => {
  it("flags a tenant for rollback after 3 consecutive failures", () => {
    const r = evaluateMonitorTick({
      tenantId: "t1",
      recent: [false, false, false, true], // newest first: 3-streak fail
    })
    expect(r.shouldRollback).toBe(true)
  })
  it("does not roll back on 2 failures", () => {
    expect(evaluateMonitorTick({ tenantId: "t1", recent: [false, false, true] })
      .shouldRollback).toBe(false)
  })
  it("does not roll back when healthy", () => {
    expect(evaluateMonitorTick({ tenantId: "t1", recent: [true, true, true] })
      .shouldRollback).toBe(false)
  })
})
```

- [ ] **Step 6: Run test, verify it fails**

Run: `cd apps/workers && npx vitest run __tests__/deploy-monitor.test.ts`
Expected: FAIL — `Cannot find module '../src/cron/deploy-monitor'`.

- [ ] **Step 7: Implement the monitor cron**

```ts
// apps/workers/src/cron/deploy-monitor.ts
import pino from "pino"
import { alertOps } from "../provisioning/notify"
const log = pino({ name: "deploy-monitor" })

export interface MonitorTick { tenantId: string; recent: boolean[] }
export interface MonitorDecision { shouldRollback: boolean }

// Pure decision: roll back when the 3 most-recent health checks all failed
// (spec §7 "on 3 consecutive failures for a tenant"). `recent` is newest-first.
export function evaluateMonitorTick(t: MonitorTick): MonitorDecision {
  const last3 = t.recent.slice(0, 3)
  return { shouldRollback: last3.length === 3 && last3.every(ok => ok === false) }
}

// Wired by the workflow `monitor` job: for ~1 hour, every 5 min, read the most
// recent tenant_health_log rows per active tenant, and on a 3-streak invoke
// scripts/rollback-tenant.ts + alert. (Reuses the Phase-A health-check cron
// data; does NOT re-implement probing.)
export async function runMonitorPass(deps: {
  listActiveTenantsWithInfra: () => Promise<{
    tenantId: string; slug: string; recent: boolean[]
    vercelProjectId: string; railwayApiServiceId: string
  }[]>
  rollback: (a: { vercelProjectId: string; railwayApiServiceId: string }) => Promise<void>
}): Promise<void> {
  const tenants = await deps.listActiveTenantsWithInfra()
  for (const t of tenants) {
    const { shouldRollback } = evaluateMonitorTick({ tenantId: t.tenantId, recent: t.recent })
    if (!shouldRollback) continue
    log.error({ tenant: t.slug }, "3-streak health failure — auto-rolling back")
    try {
      await deps.rollback({
        vercelProjectId: t.vercelProjectId,
        railwayApiServiceId: t.railwayApiServiceId,
      })
      await alertOps(
        `Auto-rollback executed for ${t.slug}`,
        `3 consecutive post-deploy health failures. Vercel rolled back + Railway redeployed. Investigate per docs/runbooks/code-deploy-broke-everyone.md.`,
      )
    } catch (e) {
      await alertOps(
        `Auto-rollback FAILED for ${t.slug}`,
        `Manual intervention required: ${String(e)}. Follow docs/runbooks/code-deploy-broke-everyone.md.`,
      )
    }
  }
}
```

- [ ] **Step 8: Run test, verify it passes**

Run: `cd apps/workers && npx vitest run __tests__/deploy-monitor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Append the `monitor` job to the fan-out workflow**

Append to `.github/workflows/deploy-production-fanout.yml` (after the `promote` job; `needs: promote`):

```yaml
  monitor:
    needs: promote
    runs-on: ubuntu-latest
    timeout-minutes: 70
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: Post-deploy watch (1h, 5-min poll, 3-streak → rollback)
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
          CONTROL_DB_URL: ${{ secrets.CONTROL_DB_URL }}
          CONTROL_DB_SERVICE_ROLE_KEY: ${{ secrets.CONTROL_DB_SERVICE_ROLE_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: npx tsx scripts/deploy-monitor-run.ts
```

> **Plan note:** add a thin `scripts/deploy-monitor-run.ts` entrypoint that loops 12 times with a 5-min sleep, each iteration calling `runMonitorPass` with a `listActiveTenantsWithInfra` impl that reads the control DB (`tenants` join `tenant_infrastructure`, last 3 `tenant_health_log` rows per tenant) and `rollback` bound to `rollbackTenant`. This is a ≤40-line glue file fully specified by Steps 3+7's exported signatures — write it in this step (no TBD): import `rollbackTenant` from `./rollback-tenant`, `runMonitorPass` from `../apps/workers/src/cron/deploy-monitor`, build the control client with `@realreal/control-db`, `for (let i=0;i<12;i++){ await runMonitorPass(deps); await new Promise(r=>setTimeout(r,300_000)) }`.

- [ ] **Step 10: Full suites + typecheck**

Run: `cd apps/workers && npx vitest run && npx tsc --noEmit && cd /Users/cataholic/.gemini/File/G && npx vitest run scripts/__tests__/rollback-tenant.test.ts`
Expected: PASS. Also: `node -e "require('js-yaml')" 2>/dev/null && npx --yes yaml-lint .github/workflows/deploy-production-fanout.yml || python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/deploy-production-fanout.yml'))"` → no output / exit 0 (workflow YAML is valid).

- [ ] **Step 11: Commit**

```bash
git add scripts/rollback-tenant.ts scripts/deploy-monitor-run.ts scripts/__tests__/rollback-tenant.test.ts apps/workers/src/cron/deploy-monitor.ts apps/workers/__tests__/deploy-monitor.test.ts .github/workflows/deploy-production-fanout.yml
git commit -m "$(cat <<'EOF'
feat(deploy): post-deploy monitor + auto-rollback (Phase E, spec §7)

Implements the deploy-production-fanout `monitor` job deferred from Phase D:
1h watch, 5-min poll, 3-consecutive-failure → Vercel rollback + Railway
redeploy + #platform-ops alert.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> **USER-ACTIONABLE:** ensure GitHub repo secret `SLACK_WEBHOOK_URL` exists (spec §12 Q1) — if `#platform-ops` is not yet set up, the alert is logged and dropped (safe degrade), but auto-rollback still runs.

---

## PR-E5: The six GA runbooks

**Why fifth:** spec §11 validation criterion "Six runbooks present in `docs/runbooks/`" is a hard GA gate; PR-E2/E4's actions are the resolution steps these runbooks cite. `stripe-webhook-pileup.md` already exists (Phase D), so this PR writes the other five **plus** `kek-rotation.md` (required by §4/§12, cross-linked from the token-leak runbook). Pure docs — no tests, verification is structural.

**Files:**
- Create: `docs/runbooks/tenant-down.md`
- Create: `docs/runbooks/supabase-quota-hit.md`
- Create: `docs/runbooks/accidental-data-delete.md`
- Create: `docs/runbooks/mcp-token-leak.md`
- Create: `docs/runbooks/code-deploy-broke-everyone.md`
- Create: `docs/runbooks/kek-rotation.md`

- [ ] **Step 1: Write `tenant-down.md`** (spec §9 runbook 1; mirrors stripe-webhook-pileup.md structure)

```markdown
# Runbook: Tenant down

> Spec §9 "Tenant runtime — crashes, healthcheck failures". Triggered by the
> 5-min health-check cron's 3-streak ALERT to #platform-ops, or a customer
> report.

## Symptom
A tenant's storefront, API, or MCP endpoint is 5xx/unreachable.
`tenant_health_log` shows recent rows with `vercel_ok`/`api_ok`/`mcp_ok`/
`supabase_ok = false`. Control dashboard home "Max health-fail streak" ≥ 3,
or the tenant detail page health strip shows red.

## Diagnose
1. Identify the tenant and its infra in the control dashboard:
   `/tenants?q=<slug>` → `/tenants/<id>` (Infrastructure section: Vercel /
   Railway api / Railway mcp / Supabase ref).
2. Probe each layer (replace hosts from the detail page):
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://<storefront>/         # expect 200
   curl -sS https://<railway-api>/health                                   # expect {"status":"ok"...}
   curl -sS https://<railway-mcp>/health                                   # expect 200 (NOTE: mcp route is /health, not /healthz)
   ```
3. Control DB — last 20 checks for the tenant:
   ```sql
   select checked_at, vercel_ok, api_ok, mcp_ok, supabase_ok, details
   from tenant_health_log where tenant_id = '<id>'
   order by checked_at desc limit 20;
   ```
4. Read the failing layer's native logs (Vercel deploy logs / Railway service
   logs / Supabase logs — v1 has no aggregation, open the provider console).

## Resolve
- **Single layer just deployed and broke** → this is a deploy regression for
  this tenant: follow `code-deploy-broke-everyone.md` (single-tenant rollback
  is `scripts/rollback-tenant.ts`).
- **Railway service crashed / OOM** → redeploy the service from the Railway
  console; it is stateless and reads config from env + tenant Supabase.
- **Supabase project paused/over quota** → follow `supabase-quota-hit.md`.
- **Vercel build failing** → check the Vercel project deploy; if a bad
  production commit, revert the PR on `production` and re-run the fan-out.
- After recovery, confirm the next health-check tick is green in
  `tenant_health_log`; the dashboard streak resets to 0.

## Escalate
- > 5 min customer-visible downtime → notify the customer (spec §9 layer
  table: "notifies customer if >5 min").
- Multiple tenants down simultaneously → this is platform-wide:
  `code-deploy-broke-everyone.md`, ALERT + page the platform admin.

## USER-ACTIONABLE
Notifying the customer and any provider-console action (Railway redeploy,
Supabase unpause, Vercel revert) are performed by the on-call human; no agent
performs production recovery actions.
```

- [ ] **Step 2: Write `supabase-quota-hit.md`** (spec §9 runbook 3)

```markdown
# Runbook: Supabase quota / project limit hit

> Spec §9 "Mgmt API quota" + §12 Q3 "Resend/Supabase account quota". Per-tenant
> Supabase projects; the platform org has a finite project + compute budget.

## Symptom
Provisioning step `supabase_setup` fails with a 4xx mentioning quota/limit, or
an existing tenant's `supabase_ok=false` with the Supabase project paused, or
the Supabase org dashboard shows the project cap reached.

## Diagnose
1. Control DB — which tenants and which step:
   ```sql
   select tenant_id, step, last_error from provisioning_jobs
   where status = 'failed' and step = 'supabase_setup'
   order by created_at desc;
   ```
2. Supabase org dashboard → project count vs plan cap; per-project compute /
   storage / egress usage.
3. Distinguish: (a) **org project-count cap** (cannot create new tenants),
   (b) **per-project resource** (one tenant degraded), (c) **Mgmt-API rate
   limit 429** (transient — provisioning auto-retries on backoff).

## Resolve
- **429 Mgmt-API rate limit** → no action; the provisioning retry ladder
  (30s → 2min) drains it. Confirm jobs move `failed`→`queued`→`success`.
- **Per-project resource exhaustion** → upgrade that tenant's Supabase project
  compute add-on in the Supabase dashboard; the tenant is single-Supabase so
  this is isolated.
- **Org project-count cap** → provisioning of *new* tenants is blocked.
  Upgrade the Supabase org plan / open a quota request. Until then, new
  `provisioning_jobs` for `supabase_setup` will keep failing; pause intake by
  not flipping Stripe live capacity (see ga-go-live-checklist.md).

## Escalate
Org cap reached with paid customers waiting → ALERT #platform-ops + email; this
gates GA throughput and is a §12 Q3 open item to resolve before scaling.

## USER-ACTIONABLE
Supabase plan upgrades, quota-increase requests, and per-project compute
changes require billing access to the Supabase org dashboard — performed by
the human operator, not an agent.
```

- [ ] **Step 3: Write `accidental-data-delete.md`** (spec §9 runbook 4)

```markdown
# Runbook: Accidental tenant data deletion

> Spec §9 "Backups": tenant Supabase has Supabase Pro PITR (7 days), one-click
> restore. Tenant Storage has NO v1 backup (accepted risk).

## Symptom
A tenant reports missing products/orders/users, or an MCP `delete_*` /
`update_*` tool call (or admin action) destroyed data. Tenant DB
`config_history` / control `audit_log` shows the destructive action.

## Diagnose
1. Scope the damage and time window:
   ```sql
   -- control plane: who/when (customer_agent actions are MCP tool calls)
   select created_at, actor_type, actor_id, action, resource, payload
   from audit_log where tenant_id = '<id>'
   and action ilike '%delete%' order by created_at desc limit 50;
   ```
2. In the tenant's Supabase, inspect `config_history` for content changes and
   the affected tables' row counts vs the customer's expectation.
3. Pick a **restore target timestamp** strictly before the destructive action.

## Resolve
- **Data in Postgres (products/orders/users/site_contents)** → Supabase
  dashboard → Database → **Point-in-Time Recovery** → restore the tenant
  project to the target timestamp (≤7 days). This restores the whole tenant
  DB; coordinate a brief tenant freeze first (`/tenants/<id>/suspend`) so no
  writes are lost mid-restore, then resume.
- **Partial / surgical** (one table) → if PITR-of-everything is too broad,
  do a PITR restore into a *clone* project, export the needed rows, and import
  them back. (Slower; only when a full restore would lose good newer data.)
- **Storage objects (images/branding/posts-media)** → NO v1 backup (spec §9).
  Ask the customer for source files and re-upload. Record as a known v1 risk.

## Escalate
Any restore that loses newer good data, or a destructive MCP tool with no
audit row → ALERT #platform-ops; review whether the MCP tool needs a
confirmation gate (feed into the tool catalog backlog).

## USER-ACTIONABLE
PITR restore is performed by the human operator in the Supabase dashboard
(irreversible window selection, customer coordination). No agent triggers a
production data restore.
```

- [ ] **Step 4: Write `mcp-token-leak.md`** (spec §9 runbook 5; cross-links kek-rotation.md)

```markdown
# Runbook: MCP token leak

> Spec §8: one long-lived bearer token per tenant; only `bcrypt` hash stored
> in `tenant_infrastructure.mcp_token_hash`. Rotation is platform-admin via the
> control dashboard (customer self-service rotation is §13 out of scope).

## Symptom
A tenant's `mcp_access_token` is exposed (committed to a repo, pasted in a
ticket, found in logs), or `audit_log` shows `customer_agent` actions from an
unexpected source / abnormal rate (rate-limit 429s in audit).

## Diagnose
1. Confirm the token is for which tenant (the customer reports their slug; or
   match the exposed token's usage pattern in `audit_log`):
   ```sql
   select created_at, actor_id, action, resource from audit_log
   where tenant_id = '<id>' and actor_type = 'customer_agent'
   order by created_at desc limit 100;
   ```
2. Assess blast radius: the MCP token only grants that tenant's admin-level
   tool catalog (spec boundary rule: agent privileges ≤ tenant admin, never
   platform). It cannot touch other tenants or the control plane.

## Resolve
1. **Rotate immediately:** control dashboard → `/tenants/<id>` → "Rotate MCP
   token". This generates a new 32-byte token, stores only its new bcrypt
   hash, writes `mcp_token.rotated` to `audit_log`, and shows the new plaintext
   **once**. The old token stops authenticating on the MCP server's next auth
   refresh.
2. Securely deliver the new token to the customer (same channel as the welcome
   email; never email it in plaintext to a shared inbox if avoidable).
3. **If the tenant Supabase service-role key may also be exposed** (e.g. the
   leak was a full env dump, not just the MCP token) → the service-role key is
   KEK-encrypted at rest but the live env value is sensitive: follow
   **`kek-rotation.md`** to rotate `PLATFORM_KEK` and re-encrypt, and rotate
   the tenant Supabase service-role key in the Supabase dashboard.
4. Review `audit_log` for any actions taken with the leaked token; reverse
   destructive ones via `accidental-data-delete.md` if needed.

## Escalate
Evidence the leak reached the service-role key or control plane → ALERT +
page; treat as a security incident, run `kek-rotation.md`, and notify the
customer.

## USER-ACTIONABLE
Rotating the Supabase service-role key (Supabase dashboard) and KEK rotation
are human-operator actions; the agent only ships the rotation control. Token
rotation itself is operated by the platform admin via the dashboard.
```

- [ ] **Step 5: Write `code-deploy-broke-everyone.md`** (spec §9 runbook 6; references PR-E4 monitor + scripts/rollback-tenant.ts)

```markdown
# Runbook: Code deploy broke everyone

> Spec §7 rollback table + the `deploy-production-fanout` `monitor` job
> (1h watch, 5-min poll, 3-streak → auto Vercel rollback + Railway redeploy).
> Spec §9 "Platform-wide breakage".

## Symptom
After a push to `production`, multiple tenants 5xx. The `monitor` job alerts
#platform-ops ("Auto-rollback executed/FAILED for <slug>"), or the dashboard
home shows many tenants with health-fail streaks.

## Diagnose
1. Confirm it correlates with a `production` deploy:
   ```bash
   git log production --oneline -5
   ```
2. Control DB — breadth of impact:
   ```sql
   select tenant_id, count(*) filter (where not (vercel_ok and api_ok and mcp_ok and supabase_ok)) as fails
   from tenant_health_log
   where checked_at > now() - interval '30 minutes'
   group by tenant_id order by fails desc;
   ```
3. Check the GitHub Actions `deploy-production-fanout` run: did `canary` pass
   but `promote` break tenants? Did `monitor` already auto-roll-back some?

## Resolve
- **The `monitor` job already auto-rolled-back affected tenants** (3-streak):
  verify each rolled-back tenant returns to green in `tenant_health_log`. For
  tenants that failed but had < 3-streak (not auto-rolled), roll back manually:
  ```bash
  # per tenant (ids from control DB tenant_infrastructure)
  VERCEL_TOKEN=… RAILWAY_TOKEN=… npx tsx scripts/rollback-tenant.ts \
    --vercel-project=<prj> --railway-api-service=<svc>
  ```
  (Wrap the same call as the manual entrypoint; `rollback-tenant.ts` exports
  `rollbackTenant()`.)
- **Root cause is a bad `production` commit** → revert the PR on `production`
  and re-run `deploy-production-fanout` (canary gates it; the manual approval
  on `promote` is your checkpoint). Never write a destructive `down` migration
  — ship a forward-fix migration (spec §7).
- **DB migration regression** → forward-fix migration only; re-run the
  `migrations` fan-out job.

## Escalate
`monitor` reported "Auto-rollback FAILED for <slug>" → that tenant needs hands
-on recovery (provider console); page the platform admin. Platform-wide and
not recovering after revert → declare incident, ALERT + page.

## USER-ACTIONABLE
Reverting the `production` PR, approving the re-run's `promote` gate, and any
provider-console rollback are human-operator actions. The agent ships the
automation and this runbook; it does not revert production or approve gates.
```

- [ ] **Step 6: Write `kek-rotation.md`** (spec §4 "manual procedure documented in a runbook" + §12 Q4 cadence)

```markdown
# Runbook: PLATFORM_KEK rotation

> Spec §4: `tenant_infrastructure.supabase_service_role_key_encrypted` is
> aes-256-gcm with `PLATFORM_KEK` (32-byte key in Railway env, no KMS in v1).
> §12 Q4: proposed cadence 12 months; revisit after first audit. Cross-linked
> from `mcp-token-leak.md` (run this if the KEK or a service-role key may be
> exposed).

## When to run
- Scheduled: every 12 months (spec §12 Q4 default).
- Unscheduled: suspected exposure of `PLATFORM_KEK` or any tenant
  service-role key (security incident — run immediately).

## Procedure (USER-ACTIONABLE — operator only)
This touches the live encryption key for every tenant's service-role key. It
is operated by the platform admin, never an agent.

1. **Generate the new key:** `openssl rand -hex 32` → `NEW_PLATFORM_KEK`.
2. **Re-encrypt every tenant's stored key.** Run the re-encryption with BOTH
   keys available (decrypt with old, encrypt with new):
   ```bash
   OLD_PLATFORM_KEK=<current> NEW_PLATFORM_KEK=<new> \
   CONTROL_DB_URL=… CONTROL_DB_SERVICE_ROLE_KEY=… \
     npx tsx scripts/rotate-kek.ts        # iterates tenant_infrastructure,
                                          # decrypt(old) -> encrypt(new) -> update
   ```
   > If `scripts/rotate-kek.ts` does not yet exist it is a small loop over
   > `tenant_infrastructure` reusing `@realreal/control-db` crypto
   > (`decrypt(buf, OLD)` then `encrypt(plain, NEW)`); ship it as a follow-up
   > before the first scheduled rotation. It is NOT required for GA (no key
   > is being rotated at GA) — documented here so the procedure exists.
3. **Swap the env:** set `PLATFORM_KEK=<new>` on the `platform-workers`
   Railway service AND the `platform-control` Vercel project; redeploy both.
4. **Verify:** trigger a health-check pass and confirm a control action that
   decrypts a service-role key (e.g. a provisioning retry) succeeds.
5. **Destroy the old key material** from local shells / password manager once
   verified.

## On suspected service-role key exposure
Additionally rotate the affected tenant's Supabase service-role key in the
Supabase dashboard, then re-store it (KEK-encrypted) via the control plane.

## Escalate
Any decrypt failure after the env swap → the env swap was applied before
re-encryption completed: revert `PLATFORM_KEK` to the old value, redeploy,
re-run step 2 to completion, then retry the swap.
```

- [ ] **Step 7: Verify all six canonical runbooks exist + structural lint**

Run:
```bash
cd /Users/cataholic/.gemini/File/G && ls docs/runbooks/ && \
for f in tenant-down stripe-webhook-pileup supabase-quota-hit accidental-data-delete mcp-token-leak code-deploy-broke-everyone; do \
  test -s "docs/runbooks/$f.md" && grep -q "## Symptom\|## When to run\|## A\." "docs/runbooks/$f.md" && echo "OK $f" || echo "MISSING/EMPTY $f"; done && \
test -s docs/runbooks/kek-rotation.md && echo "OK kek-rotation"
```
Expected: `OK tenant-down`, `OK stripe-webhook-pileup`, `OK supabase-quota-hit`, `OK accidental-data-delete`, `OK mcp-token-leak`, `OK code-deploy-broke-everyone`, `OK kek-rotation` — i.e. the **six spec-named runbooks** + KEK doc all present and non-empty. This satisfies spec §11 "Six runbooks present in `docs/runbooks/`".

- [ ] **Step 8: Commit**

```bash
git add docs/runbooks/tenant-down.md docs/runbooks/supabase-quota-hit.md docs/runbooks/accidental-data-delete.md docs/runbooks/mcp-token-leak.md docs/runbooks/code-deploy-broke-everyone.md docs/runbooks/kek-rotation.md
git commit -m "$(cat <<'EOF'
docs(runbooks): the six GA runbooks + KEK rotation (Phase E2)

Adds the five remaining spec §9 runbooks (stripe-webhook-pileup shipped in
Phase D) plus kek-rotation.md (§4/§12). Satisfies the §11 GA validation
criterion "Six runbooks present in docs/runbooks/".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-E6: Branded welcome email + MCP usage docs (E3)

**Why sixth:** spec E3 = "customer welcome email + MCP usage docs". `sendWelcomeEmail` is currently a bare plaintext stub; the customer's first MCP connection has no documentation. §12 Q5: "rough draft in Phase E3; full polish in v1.5" — so this is a solid first version, not exhaustive.

**Files:**
- Modify: `apps/workers/src/provisioning/notify.ts`
- Test: `apps/workers/__tests__/notify-welcome.test.ts`
- Create: `docs/customer-welcome-email.md`
- Create: `docs/mcp-usage.md`

- [ ] **Step 1: Failing test for the branded welcome email body**

```ts
// apps/workers/__tests__/notify-welcome.test.ts
import { describe, it, expect, vi, afterEach } from "vitest"
import { renderWelcomeEmail } from "../src/provisioning/notify"

afterEach(() => vi.unstubAllGlobals())

describe("renderWelcomeEmail", () => {
  it("includes site URL, MCP endpoint, the one-time token, and the docs link", () => {
    const { subject, text, html } = renderWelcomeEmail({
      brandName: "Mybrand", slug: "mybrand",
      siteUrl: "https://mybrand.platform.realreal.cc",
      mcpUrl: "https://mcp-mybrand.up.railway.app/mcp",
      mcpToken: "deadbeef".repeat(8),
    })
    expect(subject).toContain("Mybrand")
    for (const s of [
      "https://mybrand.platform.realreal.cc",
      "https://mcp-mybrand.up.railway.app/mcp",
      "deadbeef".repeat(8),
      "shown once",
    ]) {
      expect(text).toContain(s)
      expect(html).toContain(s)
    }
    expect(text).toMatch(/mcp-usage|connect/i)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/workers && npx vitest run __tests__/notify-welcome.test.ts`
Expected: FAIL — `renderWelcomeEmail` not exported.

- [ ] **Step 3: Extract a tested `renderWelcomeEmail` and use it in `sendWelcomeEmail`**

Modify `apps/workers/src/provisioning/notify.ts` — add the renderer and have `sendWelcomeEmail` use it (keep the brand name in the From header per spec §6 step 3):

```ts
export interface WelcomeEmailInput {
  brandName: string; slug: string; siteUrl: string; mcpUrl: string; mcpToken: string
}

export function renderWelcomeEmail(p: WelcomeEmailInput): {
  subject: string; text: string; html: string
} {
  const subject = `${p.brandName} is live 🎉`
  const text = [
    `Hi — your site "${p.brandName}" is now live.`,
    ``,
    `Storefront:   ${p.siteUrl}`,
    `Admin login:  ${p.siteUrl}/admin`,
    ``,
    `Connect your AI agent (Claude / Cursor) to manage the site:`,
    `  MCP endpoint: ${p.mcpUrl}`,
    `  MCP token (store securely — shown once): ${p.mcpToken}`,
    ``,
    `How to connect + what your agent can do:`,
    `  https://platform.realreal.cc/docs/mcp-usage  (or repo docs/mcp-usage.md)`,
    ``,
    `Need help? Reply to this email.`,
  ].join("\n")
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
  <h2>${esc(p.brandName)} is live 🎉</h2>
  <p>Your site is now live.</p>
  <ul>
    <li>Storefront: <a href="${p.siteUrl}">${esc(p.siteUrl)}</a></li>
    <li>Admin login: <a href="${p.siteUrl}/admin">${esc(p.siteUrl)}/admin</a></li>
  </ul>
  <p><strong>Connect your AI agent (Claude / Cursor):</strong></p>
  <ul>
    <li>MCP endpoint: <code>${esc(p.mcpUrl)}</code></li>
    <li>MCP token (store securely — <strong>shown once</strong>):
        <code>${esc(p.mcpToken)}</code></li>
  </ul>
  <p>Setup guide &amp; tool list:
    <a href="https://platform.realreal.cc/docs/mcp-usage">how to connect</a>.</p>
  </div>`
  return { subject, text, html }
}
```

Then change the existing `sendWelcomeEmail` to accept `brandName` and build the body via `renderWelcomeEmail`, sending both `text` and `html`, with `from: \`${brandName} <noreply@mail.platform.realreal.cc>\``. Update its single call site in `apps/workers/src/provisioning/steps/tenant-finalize.ts` to pass `brandName` (use `ctx.tenant.slug` capitalized as a v1 fallback if a brand name is not loaded — leave a `// TODO(v1.5): read site_contents.brand.name` is **not allowed**; instead pass `ctx.tenant.slug` and document in `docs/customer-welcome-email.md` that the brand name source is the slug in v1, brand.name in v1.5 per §12 Q5).

> Concretely, in `tenant-finalize.ts` change the `sendWelcomeEmail({...})` call to include `brandName: ctx.tenant.slug` (the existing call already passes `slug`, `siteUrl`, `mcpUrl`, `mcpToken`). Keep the function backward-compatible by defaulting `brandName` to `slug` if omitted so the existing tests do not break.

- [ ] **Step 4: Run test, verify it passes**

Run: `cd apps/workers && npx vitest run __tests__/notify-welcome.test.ts && npx vitest run`
Expected: PASS — new test green, **all pre-existing workers tests still green** (the `sendWelcomeEmail` change is backward-compatible).

- [ ] **Step 5: Write `docs/customer-welcome-email.md`** (the copy of record)

```markdown
# Customer welcome email (copy of record)

> Spec E3. The rendered source of truth is `renderWelcomeEmail()` in
> `apps/workers/src/provisioning/notify.ts` (unit-tested in
> `apps/workers/__tests__/notify-welcome.test.ts`). This doc is the
> human-reviewed copy + rationale; change both together.

## When it is sent
Provisioning step 8 `tenant_finalize` (spec §6), exactly once, after the
tenant is `active`. `From:` is `<Brand Name> <noreply@mail.platform.realreal.cc>`
(platform-subdomain shared sender; BYO-domain tenants use their own DKIM —
spec §6 step 3).

## Contents (must include)
- Storefront URL + `/admin` login URL.
- MCP endpoint URL.
- The MCP bearer token — **shown once**, never re-derivable (only its bcrypt
  hash is stored; spec §8). If lost, the platform admin rotates it
  (`mcp-token-leak.md`).
- A link to the MCP usage guide (`docs/mcp-usage.md`).

## v1 limitations (spec §12 Q5)
- Brand name in v1 = the tenant slug. v1.5 will read
  `site_contents.brand.name`. Documented here so the discrepancy is intended,
  not a bug.
- Plain transactional copy; richer onboarding sequence is v1.5.
```

- [ ] **Step 6: Write `docs/mcp-usage.md`** (customer-facing MCP connection guide + tool catalog)

````markdown
# Connecting your AI agent (MCP)

> Spec §8. Each tenant runs its own MCP server. Your own LLM (Claude
> Desktop / Claude Code / Cursor) connects to it with the bearer token from
> your welcome email and manages your site in natural language.

## What you need
- Your **MCP endpoint** (from the welcome email), e.g.
  `https://mcp-<slug>.up.railway.app/mcp`.
- Your **MCP token** (from the welcome email, shown once). Lost it? Contact
  support — the platform admin will rotate and re-issue it (your old token
  stops working).

## Connect (Claude Code example)
```json
{
  "mcpServers": {
    "my-site": {
      "url": "https://mcp-<slug>.up.railway.app/mcp",
      "headers": { "Authorization": "Bearer <your-mcp-token>" }
    }
  }
}
```
Claude Desktop / Cursor: add the same URL + `Authorization: Bearer` header in
their MCP server settings. Transport is HTTP + SSE (stateless).

## What your agent can do (v1 tool catalog)
The available tools depend on which **modules** are enabled for your site
(toggling a module changes the catalog within ~60s). Core namespaces:

- **brand**: site info, brand colors/logo, homepage hero & banner, about,
  FAQ, SEO, footer, site notice.
- **modules**: list / enable / disable modules and their config.
- **products**: list/create/update/delete products, variants, prices, stock,
  images.
- **categories**: list/create/update/delete.
- **orders**: list/get, update status, refund, resend confirmation.
- **campaigns / coupons** *(needs the campaigns module)*.
- **posts** *(needs the cms_posts module)*.
- **subscriptions** *(needs the subscriptions module)*.
- **members**: list/get users, membership tiers.
- **reviews** *(needs the product_reviews module)*.
- **payments**: view (masked) / update payment config.

Example prompts:
- "Make the homepage hero spring-themed and set all products to 20% off."
- "Create a product 'Oolong 150g' at NT$480 with 50 in stock."
- "Enable the courses module."

## Limits & safety
- Rate limit: 1000 tool calls/hour, 50/minute (excess → HTTP 429).
- Your agent acts as your site's admin only — it **cannot** see or touch any
  other customer or the platform (spec boundary rules).
- Every successful change is recorded in your site's change history.

## Trouble
- `401` → token wrong/rotated; get a fresh one from support.
- `429` → you hit the rate limit; slow down.
- A tool is "not found" → its module is disabled; enable it via the
  **modules** namespace (or the admin UI) and retry.
````

- [ ] **Step 7: Typecheck + full workers suite**

Run: `cd apps/workers && npx tsc --noEmit && npx vitest run`
Expected: PASS, no TS errors, all prior tests still green.

- [ ] **Step 8: Commit**

```bash
git add apps/workers/src/provisioning/notify.ts apps/workers/src/provisioning/steps/tenant-finalize.ts apps/workers/__tests__/notify-welcome.test.ts docs/customer-welcome-email.md docs/mcp-usage.md
git commit -m "$(cat <<'EOF'
feat(workers,docs): branded welcome email + MCP usage docs (Phase E3)

renderWelcomeEmail() produces a branded text+HTML body (unit tested);
docs/mcp-usage.md is the customer MCP connection guide + tool catalog.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-E7: GA go-live — Stripe test-mode scaffolding + landing page + USER-ACTIONABLE cutover checklist (E4 + E5)

**Why last:** E4 (realreal.cc DNS cutover) and E5 (Stripe **live** mode, landing page open, first paying tenant) are inherently irreversible production/financial/DNS actions. The **agent ships only**: the public landing/pricing page code and a Stripe **test-mode** Checkout link, plus the authoritative USER-ACTIONABLE checklist. **No agent performs any live financial or DNS action.**

**Files:**
- Create: `apps/web/src/app/(marketing)/buy/page.tsx`
- Test: `apps/web/src/app/(marketing)/buy/__tests__/buy.test.tsx`
- Create: `docs/ga-go-live-checklist.md`

> **`apps/web` is Next 16 — read `apps/web/AGENTS.md` + the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing the route.** Confirm the route-group `(marketing)` does not collide with existing `apps/web/src/app` routes (current top-level routes listed in "Required reading"); if a landing/pricing page already exists, extend it instead of creating `(marketing)/buy`.

- [ ] **Step 1: Failing test for the landing page (test-mode link, no live secrets)**

```tsx
// apps/web/src/app/(marketing)/buy/__tests__/buy.test.tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import BuyPage from "../page"

describe("BuyPage", () => {
  it("renders pricing and a Checkout CTA pointing at the configured (test-mode) link", () => {
    process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL = "https://buy.stripe.com/test_abc"
    render(<BuyPage />)
    expect(screen.getByText(/NT\$10,000/)).toBeTruthy()
    const cta = screen.getByRole("link", { name: /get started|buy|start/i })
    expect(cta.getAttribute("href")).toBe("https://buy.stripe.com/test_abc")
  })
  it("falls back to a safe placeholder when no checkout URL is configured", () => {
    delete process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL
    render(<BuyPage />)
    expect(screen.getByRole("link", { name: /get started|buy|start/i })
      .getAttribute("href")).toBe("#")
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/web && npx vitest run "src/app/(marketing)/buy/__tests__/buy.test.tsx"`
Expected: FAIL — `Cannot find module '../page'`.

- [ ] **Step 3: Implement the landing/pricing page (no secrets in code; URL from env)**

```tsx
// apps/web/src/app/(marketing)/buy/page.tsx
// Public landing/pricing page. The Checkout URL is injected via
// NEXT_PUBLIC_STRIPE_CHECKOUT_URL — TEST-mode link until GA. Flipping it to a
// LIVE Stripe payment link is a USER-ACTIONABLE step (see
// docs/ga-go-live-checklist.md). No secret keys ever live in this file.
export const metadata = { title: "Get your own branded store" }

export default function BuyPage() {
  const checkoutUrl = process.env.NEXT_PUBLIC_STRIPE_CHECKOUT_URL || "#"
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
      <h1>Your own branded online store, live in minutes</h1>
      <p>
        A fully managed e-commerce site — products, orders, subscriptions,
        campaigns — controllable by your own AI agent over MCP.
      </p>
      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 24, marginTop: 24 }}>
        <h2>Standard</h2>
        <p style={{ fontSize: 28, fontWeight: 700 }}>NT$10,000 / month</p>
        <ul>
          <li>Branded storefront on a platform subdomain (BYO domain supported)</li>
          <li>Admin dashboard + AI-agent control (MCP)</li>
          <li>Subscriptions, campaigns, CMS, membership tiers</li>
          <li>Automated setup — live in 5–8 minutes</li>
        </ul>
        <a
          href={checkoutUrl}
          style={{
            display: "inline-block", marginTop: 16, padding: "10px 20px",
            background: "#2d3436", color: "#fff", borderRadius: 6,
            textDecoration: "none",
          }}
        >
          Get started
        </a>
      </section>
      <p style={{ marginTop: 16, fontSize: 13, color: "#666" }}>
        Questions? Email us — we reply within one business day.
      </p>
    </main>
  )
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd apps/web && npx vitest run "src/app/(marketing)/buy/__tests__/buy.test.tsx"`
Expected: PASS (2 tests). Then `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Write the authoritative USER-ACTIONABLE go-live checklist (E4 + E5)**

```markdown
# GA go-live checklist (E4 + E5) — USER-ACTIONABLE

> **Every step in this document is performed by the human operator.** No agent
> executes DNS changes, Stripe live-mode activation, live key creation, or
> onboarding a paying customer. This checklist is the agent's *deliverable*;
> the actions are the operator's.

## Pre-flight (agent-automatable parts are already merged)
- [ ] Phase E1 dashboard polish merged & deployed to `platform.realreal.cc`.
- [ ] Six runbooks present in `docs/runbooks/` (validation: see
      `2026-05-10` spec §11). Confirm: `ls docs/runbooks/`.
- [ ] `deploy-production-fanout` `monitor` job merged (PR-E4); secret
      `SLACK_WEBHOOK_URL` set (spec §12 Q1).
- [ ] Welcome email + `docs/mcp-usage.md` merged (PR-E6).
- [ ] Landing page deployed with `NEXT_PUBLIC_STRIPE_CHECKOUT_URL` pointing at
      a **TEST-mode** Stripe payment link; end-to-end test-mode provisioning of
      a throwaway tenant passes (Phase D L3 / `stripe-webhook-pileup.md` §B).

## E4 — realreal.cc DNS cutover  (USER-ACTIONABLE)
> Per the existing 2026-05-17 plan; spec §11 says this is "unaffected" and
> independent — the infra it cuts over to is the same infra we fold in as
> tenant #1, only the registry/identity changes, not the runtime.
- [ ] **(USER)** On the cutover date, update `realreal.cc` DNS at the registrar
      / Cloudflare to point at the tenant-#1 Vercel + Railway exactly as the
      2026-05-17 plan specifies. Do **not** let any agent edit production DNS.
- [ ] **(USER)** Verify `https://realreal.cc` → 200 with pre-migration parity
      (front-end visual + functional), and the control dashboard shows
      tenant #1 = `realreal`, `status=active`.
- [ ] **(USER)** Confirm `tenant_health_log` shows 24h continuous green for
      realreal before proceeding to E5.

## E5 — Stripe live mode + landing open + first paying tenant  (USER-ACTIONABLE)
- [ ] **(USER)** In the Stripe dashboard, complete account activation for
      **live** mode (business/bank details). Create the live product + price
      (spec §12 Q2) mirroring the test-mode one.
- [ ] **(USER)** Create the **live** webhook endpoint → workers
      `/webhooks/stripe`; put the **live** `STRIPE_SECRET_KEY` +
      `STRIPE_WEBHOOK_SECRET` into the `platform-workers` Railway env. Live
      keys never enter the repo, env example files, or any agent context.
- [ ] **(USER)** Create the **live** Stripe Checkout/payment link; set
      `NEXT_PUBLIC_STRIPE_CHECKOUT_URL` on the landing-page Vercel project to
      the live link; redeploy. The landing page is now "open".
- [ ] **(USER)** Onboard the first paying tenant: a real customer (or the
      "one internal test tenant in live mode, stable for 7 days" per spec §11
      validation) completes live Checkout → automated provisioning runs → site
      live in 5–8 min → welcome email received → MCP connects.
- [ ] **(USER)** Watch `/jobs` and `tenant_health_log` for the first live
      provision; have `tenant-down.md` / `stripe-webhook-pileup.md` open.

## GA "done" (spec §11 validation criteria)
- [ ] `https://realreal.cc` 200, parity. (E4)
- [ ] `https://platform.realreal.cc` 200, dashboard shows tenant #1. (E1)
- [ ] Control DB `tenants` shows `realreal` `status=active`.
- [ ] `tenant_health_log` 24h continuous green for realreal. (E4)
- [ ] Claude Code → MCP `update_brand --primary_color=#ff0000` → page red →
      revert. (uses PR-E6 docs + existing MCP)
- [ ] Stripe **test**-mode end-to-end provision of a throwaway tenant passes
      in 5–8 min + smoke (Phase D harness; pre-flight above).
- [ ] One internal test tenant live in **Stripe live mode**, stable 7 days. (E5)
- [ ] **Six runbooks present in `docs/runbooks/`.** (PR-E5)

## Roll-back of GA itself
If the first live provision fails irrecoverably: set
`NEXT_PUBLIC_STRIPE_CHECKOUT_URL` back to the test link (closes intake),
diagnose via `/jobs` + the runbooks, fix, re-open. realreal (tenant #1) is
unaffected by intake state.
```

- [ ] **Step 6: Verify checklist + landing page; full web suite**

Run:
```bash
cd /Users/cataholic/.gemini/File/G && test -s docs/ga-go-live-checklist.md && \
grep -q "USER-ACTIONABLE" docs/ga-go-live-checklist.md && \
grep -qi "no agent" docs/ga-go-live-checklist.md && echo "checklist OK" && \
cd apps/web && npx vitest run "src/app/(marketing)/buy/__tests__/buy.test.tsx" && npx tsc --noEmit
```
Expected: `checklist OK`, landing tests PASS, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(marketing)/buy" docs/ga-go-live-checklist.md
git commit -m "$(cat <<'EOF'
feat(web,docs): GA landing page (test-mode) + USER-ACTIONABLE cutover checklist (Phase E4/E5)

Ships only the landing/pricing page (Stripe TEST-mode link via env) and the
authoritative go-live checklist. All live financial/DNS actions are explicitly
USER-ACTIONABLE and performed by the operator, never an agent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> **USER-ACTIONABLE (recap — operator only, no agent):** Stripe account live activation; create live product/price/webhook/payment-link; put live keys in Railway env; flip `NEXT_PUBLIC_STRIPE_CHECKOUT_URL` to the live link; the realreal.cc DNS cutover; onboarding the first paying customer; approving the GitHub `production-fanout` environment gate.

---

## Self-Review

**1. Spec coverage (Phase E §11 lines 893–899 + §4/§7/§8/§9/§11 validation + §12):**

| Spec requirement | Covered by | Nature |
|---|---|---|
| §11 **E1** control plane dashboard polish | PR-E1 (§9 KPI home, §4 tenant filter/search), PR-E2 (§4 `/tenants/[id]/provision` + `/suspend`, §6 retry), PR-E3 (§4 `/billing`, `/tenants/[id]/audit`, §8 token rotation) — completes the §4 nine-page set | Agent |
| §11 **E2** 6 runbooks | PR-E5 — five new + existing `stripe-webhook-pileup.md` (Phase D) = the six §9-named; `kek-rotation.md` added for §4/§12 | Agent |
| §11 **E3** customer welcome email + MCP usage docs | PR-E6 (`renderWelcomeEmail`, `docs/customer-welcome-email.md`, `docs/mcp-usage.md`) | Agent |
| §11 **E4** realreal.cc DNS cutover | PR-E7 `docs/ga-go-live-checklist.md` E4 section — **USER-ACTIONABLE** (no agent DNS) | User |
| §11 **E5** Stripe live, landing open, first paying tenant | PR-E7 — landing page code + test-mode link **(Agent)**; live keys/activation/DNS-flip/paying customer **(USER-ACTIONABLE)** | Mixed |
| §4 nine dashboard pages | PR-E1 (`/`, `/tenants`) + existing + PR-E2 (`/tenants/[id]/provision`, `/suspend`) + PR-E3 (`/tenants/[id]/audit`, `/billing`); `/jobs`, `/audit`, `/tenants/[id]` shipped Phase A | Agent |
| §9 KPI home (the 6 named KPIs) | PR-E1 `computeKpis` + home page (active count, provisioning p95, MCP call count + error rate, max health-fail streak; 5xx wired as 0 — see ambiguity 4) | Agent |
| §6 "Retry from this step" | PR-E2 `requeueStep` + `/tenants/[id]/provision` | Agent |
| §9 suspend/freeze tenant | PR-E2 `suspendTenant`/`resumeTenant` + `/tenants/[id]/suspend` | Agent |
| §8 platform-admin MCP token rotation | PR-E3 `rotateMcpToken` (bcrypt, shown once, audited) | Agent |
| §7 `deploy-production-fanout` `monitor` job + auto-rollback (Phase D deferred) | PR-E4 `deploy-monitor.ts` + `rollback-tenant.ts` + workflow `monitor` job | Agent |
| §9 six runbooks "must exist before GA" / §11 "Six runbooks present" | PR-E5 (verification step asserts the exact six) | Agent |
| §11 validation: realreal 200/parity, 24h green, MCP update_brand round-trip, test-mode + live-mode provision | PR-E7 checklist maps every criterion to PR-E1..E6 + USER steps | Mixed |
| §12 Q1 Slack webhook | PR-E4 USER-ACTIONABLE note (safe degrade if absent) | User |
| §12 Q2 Stripe price IDs / Q3 Resend·Supabase quota / Q4 KEK cadence / Q5 onboarding docs | Q2→PR-E7 checklist; Q3→`supabase-quota-hit.md` (PR-E5); Q4→`kek-rotation.md` (PR-E5); Q5→PR-E6 (explicitly "v1 draft") | Mixed |
| §13 out-of-scope (customer self-service token UI; plan up/downgrade; unattended BYO) | Respected — PR-E3 ships **platform-admin** rotation only; no plan-change UI; BYO stays manual-gate | — |

No spec Phase-E requirement is left without a task.

**2. Placeholder scan:** No "TBD/TODO/implement later". Two bounded engineer notes are deliberate, fully-specified handoffs, not placeholders: (a) PR-E3 Step 5's token-display client island (signature + behavior given; ≤20-line `useActionState` island); (b) PR-E4 Step 9's `scripts/deploy-monitor-run.ts` glue (exact loop + imports + bound deps specified). `kek-rotation.md` notes `scripts/rotate-kek.ts` is a documented follow-up explicitly **not required for GA** (no key rotates at GA) — this is a scoping statement, not a missing task.

**3. Type consistency:** `requeueStep(client,tenantId,step)`, `suspendTenant/resumeTenant(client,tenantId[,reason])`, `hashMcpToken()→{token,hash}`, `setMcpTokenHash(client,tenantId,hash)`, `computeKpis(KpiInput)→Kpis`, `parseTenantFilter→{status,q}` / `TENANT_STATUSES`, `rollbackTenant(RollbackArgs)`, `evaluateMonitorTick({tenantId,recent})→{shouldRollback}`, `runMonitorPass(deps)`, `renderWelcomeEmail(WelcomeEmailInput)→{subject,text,html}` — every signature defined once and used unchanged at every call site (server actions, workflow glue, tenant-finalize). `TenantStatus` union matches `statusColor` keys in `src/lib/format.ts`. The MCP health path is consistently documented as **`/health`** (matching `apps/mcp/src/index.ts`), never `/healthz`.

**Spec ambiguities resolved (also reported to the user):**
1. *"6 runbooks" vs the brief also naming KEK rotation:* spec §9 names the six **exactly** (`tenant-down`, `stripe-webhook-pileup`, `supabase-quota-hit`, `accidental-data-delete`, `mcp-token-leak`, `code-deploy-broke-everyone`). KEK rotation is required by §4/§12 but is **not** one of the canonical six. Resolved: ship the exact six (so the §11 validation "six runbooks present" passes as written) **plus** `kek-rotation.md`, cross-linked from `mcp-token-leak.md`. No spec wording is contradicted.
2. *`monitor`/auto-rollback ownership:* spec §7 lists `monitor` in `deploy-production-fanout.yml`; Phase D's Self-Review **explicitly deferred it to Phase E**. Resolved: PR-E4 owns it (cron decision pure-tested; rollback transport reuses Phase-D Vercel/Railway clients when present).
3. *MCP health path:* spec §7 smoke uses `/healthz` but the merged `apps/mcp/src/index.ts` exposes **`/health`**. Resolved: all Phase-E runbooks/probes use the **actual** merged route `/health` and call out the discrepancy in `tenant-down.md` so operators don't chase a 404. (Spec-vs-code mismatch flagged, not silently propagated.)
4. *§9 KPI `tenant_5xx_count per tenant per hour`:* v1 has no cross-platform log aggregation (spec §9/§13 explicitly OUT), so per-tenant 5xx counts have no control-plane data source in scope. Resolved: `computeKpis` keeps the field (passed `[]` → renders 0) so the home matches the spec's KPI list shape without inventing an out-of-scope log pipeline; documented as a v1.5 dependency (matches spec §9 "v1.5 forwards all to … a log viewer").
5. *Brand name in welcome email:* spec §6 says From header carries the brand name, but reading `site_contents.brand.name` from the tenant DB at `tenant_finalize` is heavier than v1 needs and §12 Q5 scopes onboarding docs as "draft, full polish v1.5". Resolved: v1 uses the tenant **slug** as the brand-name fallback (backward-compatible default), documented in `docs/customer-welcome-email.md` as intentional, brand.name in v1.5.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-phase-e-ga-readiness.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per PR (E1…E7), review between tasks.
2. **Inline Execution** — execute PRs in this session with checkpoints.

Which approach?
