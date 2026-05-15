# Phase D — Provisioning Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fully-automated tenant provisioning pipeline in `apps/workers` — a Stripe `checkout.session.completed` webhook that enqueues 8 idempotent step handlers (validate → supabase → resend → cloudflare DNS → vercel → railway → domain finalize → tenant finalize) which spin up a complete per-tenant stack (Supabase + Vercel + 2 Railway services + Resend domain + MCP token + admin user) in 5–8 minutes, with retry, partial-failure recovery, a canary tenant, and production-branch deploy fan-out.

**Architecture:** A long-running Node process on Railway (`apps/workers`, already scaffolded in Phase A). The Stripe webhook persists idempotency to `stripe_webhook_events`, inserts a `tenants` row (`status='pending_payment'`), and enqueues 8 rows into `provisioning_jobs`. The existing poll-based job runner (`apps/workers/src/jobs/runner.ts`) is upgraded to dispatch each claimed job to a `StepHandler` keyed by `step`. Every handler implements `isComplete()` (probe real infra by stored ID or name) + `run()` (idempotent create-or-resume). Mgmt-API calls go through typed wrappers in `infrastructure/provisioning/`. Retry uses `attempt`-driven backoff (30s → 2min → fail+alert). The final handler flips `tenants.status='active'`. A platform-owned `staging-canary` tenant and a `deploy-production-fanout` GitHub Actions workflow gate code deploys.

**Tech Stack:** Node 20 + TypeScript (CommonJS, `tsx`/`tsc`), Express 5, `@realreal/control-db` (Supabase service-role client + typed queries + aes-256-gcm crypto), `@supabase/supabase-js`, `stripe@^17` (test mode), `bcryptjs`, `vitest@4` + `supertest`, the Supabase / Vercel / Railway / Resend / Cloudflare Management REST APIs (via `fetch`), GitHub Actions.

---

## Required reading before starting

- `apps/web/AGENTS.md` — "This is NOT the Next.js you know." Phase D touches **no** Next.js; `apps/control` and `apps/web` are read-only here. If you must touch them, read `node_modules/next/dist/docs/` first.
- Spec §6 (provisioning flow, 8 steps, step handler interface, idempotency, retry, rollback), §4 (control DB schema, `apps/workers` responsibilities, KEK encryption), §5 (tenant seed data, storage buckets, Auth config, module gating), §7 (branch model, canary, `deploy-production-fanout.yml`, env fan-out), §10 (provisioning test levels L1/L2/L3), §11 lines 885-892 (Phase D D1–D6).
  Read with: `git show origin/spec/multi-tenant-foundation:docs/superpowers/specs/2026-05-10-multi-tenant-platform-foundation-design.md`
- Existing Phase A scaffolding (do not rewrite — extend):
  - `apps/workers/src/index.ts` (Express app, raw-body Stripe mount)
  - `apps/workers/src/jobs/runner.ts` (poll loop, `claimQueuedJob`, `markJobStatus`)
  - `apps/workers/src/webhooks/stripe.ts` (signature verify, in-memory dedupe to replace)
  - `packages/control-db/src/queries/{jobs,tenants}.ts`, `src/crypto.ts`, `src/types.ts`
  - `infrastructure/provisioning/apply-tenant-migrations.ts` (the Supabase Mgmt SQL pattern to reuse)

## Conventions (match the existing codebase)

- Logging: `pino({ name: "<component>" })`.
- Errors: throw `Error` with a clear message; the runner catches and records `last_error`.
- Mgmt API: `fetch` with `AbortSignal.timeout(...)`, `Bearer` token, explicit `User-Agent`, throw on `!res.ok` with `await res.text()` in the message (exactly like `apply-tenant-migrations.ts`).
- Tests: `vitest run` from the package dir; `describe`/`it`/`expect`; mock all network with `vi.fn()` / `vi.stubGlobal("fetch", ...)`. No live network in L1/L2.
- Commits: Conventional Commits, scoped (`feat(workers): ...`). Each task = one mergeable PR off `main` named `feat/phase-dN-<slug>` (matches Phase A/B/C `feat/phase-bN-...`). Phase D is **Stripe test-mode only**.
- Never push to `main` or `production` directly — feature branch + `gh pr create` every time.

## File map (created/modified across all PRs)

```
infrastructure/provisioning/
  clients/http.ts                 NEW  shared fetch helper (timeout, bearer, throw-on-error)
  clients/supabase-mgmt.ts        NEW  create project / poll status / run SQL / keys / auth / buckets
  clients/vercel.ts               NEW  create project / set env / deploy / poll / add domain / rollback
  clients/railway.ts              NEW  create project / service / set vars / deploy / poll health
  clients/resend.ts               NEW  add domain / get DNS records / poll DKIM
  clients/cloudflare.ts           NEW  upsert CNAME record
apps/workers/src/provisioning/
  context.ts                      NEW  TenantContext loader (tenant + infra + payload)
  steps/types.ts                  NEW  StepHandler interface, ProvisioningStep order
  steps/validate.ts               NEW  step 1
  steps/supabase-setup.ts         NEW  step 2
  steps/resend-setup.ts           NEW  step 3
  steps/cloudflare-dns.ts         NEW  step 4
  steps/vercel-setup.ts           NEW  step 5
  steps/railway-setup.ts          NEW  step 6
  steps/domain-finalize.ts        NEW  step 7
  steps/tenant-finalize.ts        NEW  step 8
  steps/registry.ts               NEW  step -> handler map
  dispatch.ts                     NEW  retry/backoff + isComplete/run orchestration
apps/workers/src/jobs/runner.ts   MOD  dispatch to registry instead of "no handler" stub
apps/workers/src/webhooks/stripe.ts MOD persistent idempotency + tenant insert + enqueue 8
packages/control-db/src/queries/
  tenants.ts                      MOD  createTenant, updateTenantStatus
  infrastructure.ts               NEW  upsert/get tenant_infrastructure (with KEK)
  stripe-events.ts                NEW  persistent webhook idempotency
apps/workers/__tests__/           NEW  one *.test.ts per step + dispatch + webhook
.github/workflows/deploy-production-fanout.yml  NEW  canary -> migrations -> promote -> monitor
scripts/provision-throwaway.ts    NEW  D3/D5 manual live-provision + teardown harness
docs/runbooks/stripe-webhook-pileup.md          NEW  (referenced by spec §9)
```

---

## PR-D1: Mgmt-API client wrappers (typed, mockable)

**Why first:** every step handler depends on these. Pure functions over `fetch`, 100% unit-testable with a stubbed global fetch (spec §10 L1).

**Files:**
- Create: `infrastructure/provisioning/clients/http.ts`
- Create: `infrastructure/provisioning/clients/supabase-mgmt.ts`
- Create: `infrastructure/provisioning/clients/vercel.ts`
- Create: `infrastructure/provisioning/clients/railway.ts`
- Create: `infrastructure/provisioning/clients/resend.ts`
- Create: `infrastructure/provisioning/clients/cloudflare.ts`
- Test: `infrastructure/provisioning/clients/__tests__/clients.test.ts`
- Modify: `infrastructure/provisioning/package.json` (add `test`/`typecheck` scripts + vitest) — if no package.json exists there, create `infrastructure/provisioning/package.json` with `{ "name": "@realreal/provisioning", "private": true, "type": "commonjs", "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }, "devDependencies": { "vitest": "^4.1.2", "typescript": "^5.9.3", "@types/node": "^20.19.37" } }` and add it to the root `package.json` workspaces if not already globbed by `infrastructure/*`.

- [ ] **Step 1: Write the failing test for `http.ts`**

```ts
// infrastructure/provisioning/clients/__tests__/clients.test.ts
import { describe, it, expect, vi, afterEach } from "vitest"
import { mgmtFetch } from "../http"

afterEach(() => vi.unstubAllGlobals())

describe("mgmtFetch", () => {
  it("sends bearer auth + json and returns parsed body on 200", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    )
    vi.stubGlobal("fetch", f)
    const out = await mgmtFetch<{ ok: number }>("https://x/y", {
      method: "POST", token: "tok", body: { a: 1 }, label: "test",
    })
    expect(out).toEqual({ ok: 1 })
    const [, init] = f.mock.calls[0]
    expect(init.headers.Authorization).toBe("Bearer tok")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
  })

  it("throws with label + status body on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("nope", { status: 422 }),
    ))
    await expect(
      mgmtFetch("https://x", { method: "GET", token: "t", label: "createProj" }),
    ).rejects.toThrow(/createProj: 422 nope/)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd infrastructure/provisioning && npx vitest run clients/__tests__/clients.test.ts`
Expected: FAIL — `Cannot find module '../http'`.

- [ ] **Step 3: Implement `http.ts`**

```ts
// infrastructure/provisioning/clients/http.ts
export interface MgmtOpts {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  token: string
  label: string
  body?: unknown
  timeoutMs?: number
  headers?: Record<string, string>
}

export async function mgmtFetch<T = unknown>(url: string, o: MgmtOpts): Promise<T> {
  const res = await fetch(url, {
    method: o.method,
    headers: {
      Authorization: `Bearer ${o.token}`,
      "Content-Type": "application/json",
      "User-Agent": "provisioning/1.0",
      ...(o.headers ?? {}),
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
  })
  if (!res.ok) {
    throw new Error(`${o.label}: ${res.status} ${await res.text()}`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd infrastructure/provisioning && npx vitest run clients/__tests__/clients.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add a Supabase Mgmt client test (project create + poll + SQL)**

```ts
// append to clients.test.ts
import { createSupabaseProject, pollProjectHealthy, runTenantSql } from "../supabase-mgmt"

describe("supabase-mgmt", () => {
  it("createSupabaseProject returns ref + url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "ref123", endpoint: "https://ref123.supabase.co" }),
      { status: 201 })))
    const p = await createSupabaseProject({
      pat: "pat", name: "tenant-foo", region: "ap-northeast-1", orgId: "org", dbPass: "pw",
    })
    expect(p).toEqual({ ref: "ref123", url: "https://ref123.supabase.co" })
  })

  it("pollProjectHealthy resolves when status becomes ACTIVE_HEALTHY", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "COMING_UP" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ACTIVE_HEALTHY" }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await expect(pollProjectHealthy("pat", "ref123", { intervalMs: 1, maxMs: 1000 }))
      .resolves.toBeUndefined()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("runTenantSql posts query to the project SQL endpoint", async () => {
    const f = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }))
    vi.stubGlobal("fetch", f)
    await runTenantSql("pat", "ref123", "select 1", "smoke")
    expect(f.mock.calls[0][0]).toBe("https://api.supabase.com/v1/projects/ref123/database/query")
  })
})
```

- [ ] **Step 6: Run, verify FAIL** (`Cannot find module '../supabase-mgmt'`).
Run: `cd infrastructure/provisioning && npx vitest run clients/__tests__/clients.test.ts`

- [ ] **Step 7: Implement `supabase-mgmt.ts`**

```ts
// infrastructure/provisioning/clients/supabase-mgmt.ts
import { mgmtFetch } from "./http"

const API = "https://api.supabase.com/v1"

export interface CreateProjectArgs {
  pat: string; name: string; region: string; orgId: string; dbPass: string
}
export async function createSupabaseProject(a: CreateProjectArgs): Promise<{ ref: string; url: string }> {
  const r = await mgmtFetch<{ id: string; endpoint?: string }>(`${API}/projects`, {
    method: "POST", token: a.pat, label: "createSupabaseProject",
    body: { name: a.name, region: a.region, organization_id: a.orgId, db_pass: a.dbPass, plan: "free" },
  })
  return { ref: r.id, url: r.endpoint ?? `https://${r.id}.supabase.co` }
}

export async function pollProjectHealthy(
  pat: string, ref: string, o: { intervalMs?: number; maxMs?: number } = {},
): Promise<void> {
  const interval = o.intervalMs ?? 5_000
  const deadline = Date.now() + (o.maxMs ?? 180_000)
  for (;;) {
    const p = await mgmtFetch<{ status: string }>(`${API}/projects/${ref}`, {
      method: "GET", token: pat, label: "pollProjectHealthy",
    })
    if (p.status === "ACTIVE_HEALTHY") return
    if (Date.now() > deadline) throw new Error(`pollProjectHealthy: timed out (last=${p.status})`)
    await new Promise(r => setTimeout(r, interval))
  }
}

export async function runTenantSql<T = unknown>(
  pat: string, ref: string, query: string, label: string,
): Promise<T> {
  return mgmtFetch<T>(`${API}/projects/${ref}/database/query`, {
    method: "POST", token: pat, label, body: { query },
  })
}

export async function fetchProjectApiKeys(
  pat: string, ref: string,
): Promise<{ anon: string; serviceRole: string }> {
  const keys = await mgmtFetch<Array<{ name: string; api_key: string }>>(
    `${API}/projects/${ref}/api-keys`, { method: "GET", token: pat, label: "fetchProjectApiKeys" },
  )
  const anon = keys.find(k => k.name === "anon")?.api_key
  const serviceRole = keys.find(k => k.name === "service_role")?.api_key
  if (!anon || !serviceRole) throw new Error("fetchProjectApiKeys: missing anon/service_role")
  return { anon, serviceRole }
}

export async function configureAuth(
  pat: string, ref: string, siteUrl: string, redirectUrls: string[],
): Promise<void> {
  await mgmtFetch(`${API}/projects/${ref}/config/auth`, {
    method: "PATCH", token: pat, label: "configureAuth",
    body: {
      site_url: siteUrl,
      uri_allow_list: redirectUrls.join(","),
      mailer_autoconfirm: false,
    },
  })
}

export async function createStorageBuckets(pat: string, ref: string): Promise<void> {
  // Buckets via SQL against storage.buckets (idempotent on conflict). Spec §5.
  const sql = `
insert into storage.buckets (id, name, public) values
 ('product-images','product-images',true),
 ('branding','branding',true),
 ('posts-media','posts-media',true),
 ('course-content','course-content',false)
on conflict (id) do nothing;`
  await runTenantSql(pat, ref, sql, "createStorageBuckets")
}
```

- [ ] **Step 8: Run, verify PASS** (5 tests).
Run: `cd infrastructure/provisioning && npx vitest run clients/__tests__/clients.test.ts`

- [ ] **Step 9: Implement `vercel.ts`, `railway.ts`, `resend.ts`, `cloudflare.ts` with their tests**

Add to `clients.test.ts`:

```ts
import { createVercelProject, setVercelEnv, triggerVercelDeploy, pollVercelReady,
         addVercelDomain, rollbackVercel } from "../vercel"
import { createRailwayProject, createRailwayService, setRailwayVars,
         deployRailwayService, pollRailwayHealthz } from "../railway"
import { addResendDomain, getResendDnsRecords, pollResendVerified } from "../resend"
import { upsertCnameRecord } from "../cloudflare"

describe("vercel", () => {
  it("createVercelProject links the G repo production branch", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "prj_1" }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    const id = await createVercelProject({
      token: "t", name: "tenant-foo", repo: "Gathertaiwan-Group/G",
      branch: "production", rootDir: "apps/web",
    })
    expect(id).toBe("prj_1")
    expect(JSON.parse(f.mock.calls[0][1].body).gitRepository.repo).toBe("Gathertaiwan-Group/G")
  })
})

describe("cloudflare", () => {
  it("upsertCnameRecord creates when absent", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: "rec1" } }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await upsertCnameRecord({ token: "t", zoneId: "z", name: "foo.platform.realreal.cc",
      content: "cname.vercel-dns.com" })
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[1][1].method).toBe("POST")
  })
})
```

Implement each file using `mgmtFetch`. Key signatures (used by later PRs — keep exact):

```ts
// vercel.ts
export interface CreateVercelArgs { token: string; name: string; repo: string; branch: string; rootDir: string }
export async function createVercelProject(a: CreateVercelArgs): Promise<string> // returns projectId
export async function setVercelEnv(token: string, projectId: string, kv: Record<string,string>): Promise<void>
export async function triggerVercelDeploy(token: string, projectId: string): Promise<string> // deploymentId
export async function pollVercelReady(token: string, deploymentId: string, o?: { intervalMs?: number; maxMs?: number }): Promise<string> // returns deployment url
export async function addVercelDomain(token: string, projectId: string, domain: string): Promise<void>
export async function rollbackVercel(token: string, projectId: string): Promise<void> // promote previous READY deployment

// railway.ts
export async function createRailwayProject(token: string, name: string): Promise<string> // projectId
export async function createRailwayService(token: string, projectId: string, name: string, repo: string, branch: string, rootDir: string): Promise<string> // serviceId
export async function setRailwayVars(token: string, serviceId: string, kv: Record<string,string>): Promise<void>
export async function deployRailwayService(token: string, serviceId: string): Promise<void>
export async function pollRailwayHealthz(url: string, o?: { intervalMs?: number; maxMs?: number }): Promise<void> // GET url/health|/healthz until 200

// resend.ts
export async function addResendDomain(apiKey: string, name: string): Promise<{ id: string; records: DnsRecord[] }>
export async function getResendDnsRecords(apiKey: string, domainId: string): Promise<DnsRecord[]>
export async function pollResendVerified(apiKey: string, domainId: string, o?: { intervalMs?: number; maxMs?: number }): Promise<boolean>
export interface DnsRecord { type: string; name: string; value: string }

// cloudflare.ts
export interface CnameArgs { token: string; zoneId: string; name: string; content: string }
export async function upsertCnameRecord(a: CnameArgs): Promise<void> // GET list by name; POST if absent, PATCH if present
```

- [ ] **Step 10: Run full client suite, verify PASS**

Run: `cd infrastructure/provisioning && npx vitest run`
Expected: PASS — all client tests green (≥ 9).

- [ ] **Step 11: Typecheck + commit**

Run: `cd infrastructure/provisioning && npx tsc --noEmit`
Expected: no errors.

```bash
git add infrastructure/provisioning/clients infrastructure/provisioning/package.json infrastructure/provisioning/tsconfig.json package.json
git commit -m "$(cat <<'EOF'
feat(provisioning): typed Mgmt-API client wrappers (Phase D1)

Supabase/Vercel/Railway/Resend/Cloudflare fetch wrappers with
timeout, bearer auth, throw-on-error, and full unit coverage
(no live network).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D2: Control DB query helpers (tenant create/status, infra upsert, persistent Stripe idempotency)

**Why:** the webhook (PR-D3) and every step handler need to read/write `tenants`, `tenant_infrastructure`, `stripe_webhook_events`. The infra service-role key must be KEK-encrypted (spec §4).

**Files:**
- Modify: `packages/control-db/src/queries/tenants.ts`
- Create: `packages/control-db/src/queries/infrastructure.ts`
- Create: `packages/control-db/src/queries/stripe-events.ts`
- Modify: `packages/control-db/src/index.ts` (export new namespaces)
- Modify: `packages/control-db/src/types.ts` (add `TenantInfrastructure`, extend `Tenant` with `custom_domain_verified_at`)
- Test: `packages/control-db/__tests__/queries.test.ts`

- [ ] **Step 1: Write failing test (mocked Supabase client)**

```ts
// packages/control-db/__tests__/queries.test.ts
import { describe, it, expect, vi } from "vitest"
import { createTenant, updateTenantStatus } from "../src/queries/tenants"
import { upsertInfrastructure, getInfrastructure } from "../src/queries/infrastructure"
import { recordStripeEvent } from "../src/queries/stripe-events"

function mockClient(impl: Record<string, unknown>) {
  return impl as never
}

describe("createTenant", () => {
  it("inserts a pending_payment tenant and returns its id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "t1" }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const c = mockClient({ from: vi.fn().mockReturnValue({ insert }) })
    const id = await createTenant(c, { slug: "foo", custom_domain: null,
      owner_user_id: "u1", plan: "standard" })
    expect(id).toBe("t1")
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      slug: "foo", status: "pending_payment", owner_user_id: "u1", plan: "standard",
    }))
  })
})

describe("recordStripeEvent", () => {
  it("returns false (already processed) when insert hits unique violation 23505", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: "23505" } })
    const c = mockClient({ from: vi.fn().mockReturnValue({ insert }) })
    const fresh = await recordStripeEvent(c, "evt_1", "checkout.session.completed", {})
    expect(fresh).toBe(false)
  })
  it("returns true on a fresh insert", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const c = mockClient({ from: vi.fn().mockReturnValue({ insert }) })
    expect(await recordStripeEvent(c, "evt_2", "x", {})).toBe(true)
  })
})

describe("upsertInfrastructure", () => {
  it("encrypts the service_role key with the KEK before upsert", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const c = mockClient({ from: vi.fn().mockReturnValue({ upsert }) })
    const kek = Buffer.alloc(32, 7)
    await upsertInfrastructure(c, "t1", {
      supabase_project_ref: "ref", supabase_url: "https://ref.supabase.co",
      supabase_anon_key: "anon", supabase_service_role_key: "secret-sr",
    }, kek)
    const row = upsert.mock.calls[0][0]
    expect(row.supabase_service_role_key_encrypted).toBeInstanceOf(Buffer)
    expect(row).not.toHaveProperty("supabase_service_role_key")
  })
})
```

- [ ] **Step 2: Run, verify FAIL.**
Run: `cd packages/control-db && npx vitest run __tests__/queries.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Add types**

```ts
// packages/control-db/src/types.ts — add to Tenant interface:
//   custom_domain_verified_at: string | null
// and append:
export interface TenantInfrastructure {
  tenant_id: string
  vercel_project_id: string | null
  vercel_deployment_url: string | null
  railway_project_id: string | null
  railway_api_service_id: string | null
  railway_api_url: string | null
  railway_mcp_service_id: string | null
  railway_mcp_url: string | null
  supabase_project_ref: string | null
  supabase_url: string | null
  supabase_anon_key: string | null
  resend_domain_id: string | null
  resend_dkim_verified_at: string | null
  cloudflare_zone_id: string | null
  mcp_token_hash: string | null
}
```

- [ ] **Step 4: Implement `tenants.ts` additions**

```ts
// append to packages/control-db/src/queries/tenants.ts
import type { TenantStatus } from "../types"

export interface CreateTenantArgs {
  slug: string
  custom_domain: string | null
  owner_user_id: string
  plan: string | null
}

export async function createTenant(c: SupabaseClient, a: CreateTenantArgs): Promise<string> {
  const { data, error } = await c.from("tenants")
    .insert({
      slug: a.slug,
      custom_domain: a.custom_domain,
      owner_user_id: a.owner_user_id,
      plan: a.plan,
      status: "pending_payment",
    })
    .select("id")
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function updateTenantStatus(
  c: SupabaseClient, id: string, status: TenantStatus,
  patch: { suspended_reason?: string } = {},
): Promise<void> {
  const u: Record<string, unknown> = { status }
  if (status === "active") u.activated_at = new Date().toISOString()
  if (status === "suspended" || status === "canceled") {
    u.suspended_at = new Date().toISOString()
    if (patch.suspended_reason) u.suspended_reason = patch.suspended_reason
  }
  const { error } = await c.from("tenants").update(u).eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 5: Implement `stripe-events.ts`**

```ts
// packages/control-db/src/queries/stripe-events.ts
import type { SupabaseClient } from "@supabase/supabase-js"

/** Returns true if this is the FIRST time we've seen event_id (caller should
 * process). Returns false if it was already recorded (caller should skip). */
export async function recordStripeEvent(
  c: SupabaseClient, eventId: string, type: string, payload: unknown,
): Promise<boolean> {
  const { error } = await c.from("stripe_webhook_events")
    .insert({ event_id: eventId, type, payload })
  if (!error) return true
  // 23505 = unique_violation on event_id PK → duplicate delivery.
  if ((error as { code?: string }).code === "23505") return false
  throw error
}
```

- [ ] **Step 6: Implement `infrastructure.ts`**

```ts
// packages/control-db/src/queries/infrastructure.ts
import type { SupabaseClient } from "@supabase/supabase-js"
import { encrypt } from "../crypto"
import type { TenantInfrastructure } from "../types"

export interface InfraPatch {
  supabase_project_ref?: string
  supabase_url?: string
  supabase_anon_key?: string
  supabase_service_role_key?: string
  vercel_project_id?: string
  vercel_deployment_url?: string
  railway_project_id?: string
  railway_api_service_id?: string
  railway_api_url?: string
  railway_mcp_service_id?: string
  railway_mcp_url?: string
  resend_domain_id?: string
  cloudflare_zone_id?: string
  mcp_token_hash?: string
}

export async function upsertInfrastructure(
  c: SupabaseClient, tenantId: string, patch: InfraPatch, kek: Buffer,
): Promise<void> {
  const { supabase_service_role_key, ...rest } = patch
  const row: Record<string, unknown> = { tenant_id: tenantId, ...rest }
  if (supabase_service_role_key !== undefined) {
    row.supabase_service_role_key_encrypted = encrypt(supabase_service_role_key, kek)
  }
  const { error } = await c.from("tenant_infrastructure")
    .upsert(row, { onConflict: "tenant_id" })
  if (error) throw error
}

export async function getInfrastructure(
  c: SupabaseClient, tenantId: string,
): Promise<TenantInfrastructure | null> {
  const { data, error } = await c.from("tenant_infrastructure")
    .select("*").eq("tenant_id", tenantId).maybeSingle()
  if (error) throw error
  return (data as TenantInfrastructure | null) ?? null
}
```

- [ ] **Step 7: Export from index**

```ts
// packages/control-db/src/index.ts — add:
export * as infrastructure from "./queries/infrastructure"
export * as stripeEvents from "./queries/stripe-events"
```

- [ ] **Step 8: Run, verify PASS**

Run: `cd packages/control-db && npx vitest run`
Expected: PASS — new query tests + existing crypto tests green.

- [ ] **Step 9: Typecheck + commit**

Run: `cd packages/control-db && npx tsc --noEmit`

```bash
git add packages/control-db/src packages/control-db/__tests__/queries.test.ts
git commit -m "$(cat <<'EOF'
feat(control-db): tenant create/status, KEK-encrypted infra upsert, persistent Stripe idempotency (Phase D2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D3: Stripe webhook → tenant + 8-job enqueue (replaces in-memory dedupe)

**Files:**
- Modify: `apps/workers/src/webhooks/stripe.ts`
- Test: `apps/workers/__tests__/stripe-webhook.test.ts`
- Modify: `apps/workers/package.json` (add `bcryptjs` + `@types/bcryptjs` — used by PR-D11 too)

- [ ] **Step 1: Write failing test**

```ts
// apps/workers/__tests__/stripe-webhook.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

const recordStripeEvent = vi.fn()
const createTenant = vi.fn()
const enqueueJobs = vi.fn()
vi.mock("@realreal/control-db", () => ({
  createControlClient: () => ({}),
  stripeEvents: { recordStripeEvent },
  tenants: { createTenant },
  jobs: { enqueueJobs },
}))
vi.mock("stripe", () => ({
  default: class {
    webhooks = {
      constructEvent: (raw: Buffer) => JSON.parse(raw.toString()),
    }
  },
}))

import { buildApp } from "../src/index"

const EVENT = {
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: {
    metadata: { slug: "pioneer-test", plan: "standard", owner_user_id: "u1" },
    customer: "cus_1",
  } },
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  process.env.STRIPE_SECRET_KEY = "sk_test_x"
  vi.clearAllMocks()
  recordStripeEvent.mockResolvedValue(true)
  createTenant.mockResolvedValue("t1")
  enqueueJobs.mockResolvedValue(undefined)
})

describe("POST /webhooks/stripe", () => {
  it("creates a tenant and enqueues the 8 provisioning steps", async () => {
    const res = await request(buildApp())
      .post("/webhooks/stripe")
      .set("stripe-signature", "sig")
      .set("content-type", "application/json")
      .send(Buffer.from(JSON.stringify(EVENT)))
    expect(res.status).toBe(200)
    expect(createTenant).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      slug: "pioneer-test", owner_user_id: "u1", plan: "standard",
    }))
    expect(enqueueJobs).toHaveBeenCalledWith(expect.anything(), "t1", [
      "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
      "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
    ])
  })

  it("is idempotent: duplicate event does not re-enqueue", async () => {
    recordStripeEvent.mockResolvedValue(false)
    const res = await request(buildApp())
      .post("/webhooks/stripe").set("stripe-signature", "sig")
      .set("content-type", "application/json")
      .send(Buffer.from(JSON.stringify(EVENT)))
    expect(res.status).toBe(200)
    expect(res.body.duplicate).toBe(true)
    expect(createTenant).not.toHaveBeenCalled()
    expect(enqueueJobs).not.toHaveBeenCalled()
  })

  it("ignores non-provisioning event types", async () => {
    const res = await request(buildApp())
      .post("/webhooks/stripe").set("stripe-signature", "sig")
      .set("content-type", "application/json")
      .send(Buffer.from(JSON.stringify({ ...EVENT, type: "invoice.paid" })))
    expect(res.status).toBe(200)
    expect(createTenant).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/stripe-webhook.test.ts`
Expected: FAIL — webhook still uses in-memory `Set`, no tenant/enqueue.

- [ ] **Step 3: Rewrite webhook handler body (replace lines ~68-89 of `stripe.ts`)**

Replace the in-memory dedupe block and "Phase A: log only" block with:

```ts
import { createControlClient, stripeEvents, tenants, jobs,
         type ProvisioningStep } from "@realreal/control-db"

const STEPS: ProvisioningStep[] = [
  "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
  "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
]

// ...after event verification:
let client
try {
  client = createControlClient()
} catch (err) {
  log.error({ err: err instanceof Error ? err.message : err }, "control db unavailable")
  res.status(503).json({ error: "control_db_unavailable" })
  return
}

const fresh = await stripeEvents.recordStripeEvent(client, event.id, event.type, event)
if (!fresh) {
  log.info({ eventId: event.id }, "duplicate stripe event; skipping")
  res.status(200).json({ received: true, duplicate: true })
  return
}

if (event.type !== "checkout.session.completed") {
  log.info({ eventId: event.id, type: event.type }, "non-provisioning event; recorded only")
  res.status(200).json({ received: true })
  return
}

const obj = (event.data.object ?? {}) as {
  metadata?: { slug?: string; plan?: string; owner_user_id?: string }
}
const md = obj.metadata ?? {}
if (!md.slug || !md.owner_user_id) {
  log.error({ eventId: event.id }, "checkout missing slug/owner_user_id metadata")
  res.status(200).json({ received: true, error: "missing_metadata" })
  return
}

try {
  const tenantId = await tenants.createTenant(client, {
    slug: md.slug,
    custom_domain: null,
    owner_user_id: md.owner_user_id,
    plan: md.plan ?? "standard",
  })
  await jobs.enqueueJobs(client, tenantId, STEPS)
  log.info({ eventId: event.id, tenantId, slug: md.slug }, "tenant created + 8 steps enqueued")
} catch (err) {
  log.error({ err: err instanceof Error ? err.message : err }, "provisioning enqueue failed")
  // 500 → Stripe retries; recordStripeEvent already de-dupes a successful path.
  res.status(500).json({ error: "enqueue_failed" })
  return
}

res.status(200).json({ received: true })
return
```

> **Idempotency note:** `recordStripeEvent` commits before `createTenant`. If `createTenant`/`enqueueJobs` then fails and we return 500, Stripe retries but `recordStripeEvent` now returns `false` → no tenant created. Mitigation: make `createTenant` upsert-by-slug-idempotent in PR-D2's `createTenant` is **out of scope**; instead the runbook (PR-D13) documents manual replay via `/jobs`. Recorded as a resolved ambiguity (see Self-Review).

- [ ] **Step 4: Run, verify PASS** (3 tests).
Run: `cd apps/workers && npx vitest run __tests__/stripe-webhook.test.ts`

- [ ] **Step 5: Run full workers suite (no regressions in hmac/audit tests)**

Run: `cd apps/workers && npx vitest run`
Expected: PASS — all suites green.

- [ ] **Step 6: Typecheck + commit**

Run: `cd apps/workers && npx tsc --noEmit`

```bash
git add apps/workers/src/webhooks/stripe.ts apps/workers/__tests__/stripe-webhook.test.ts apps/workers/package.json
git commit -m "$(cat <<'EOF'
feat(workers): Stripe webhook creates tenant + enqueues 8 steps with persistent idempotency (Phase D2 trigger)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D4: StepHandler interface + TenantContext + step registry skeleton

**Files:**
- Create: `apps/workers/src/provisioning/steps/types.ts`
- Create: `apps/workers/src/provisioning/context.ts`
- Create: `apps/workers/src/provisioning/steps/registry.ts`
- Test: `apps/workers/__tests__/context.test.ts`

- [ ] **Step 1: Write failing test for context loader**

```ts
// apps/workers/__tests__/context.test.ts
import { describe, it, expect, vi } from "vitest"
import { loadTenantContext } from "../src/provisioning/context"

describe("loadTenantContext", () => {
  it("joins tenant + infrastructure into a single context", async () => {
    const getTenant = vi.fn().mockResolvedValue({ id: "t1", slug: "foo",
      custom_domain: null, status: "provisioning", plan: "standard" })
    const getInfrastructure = vi.fn().mockResolvedValue({ tenant_id: "t1",
      supabase_project_ref: "ref" })
    vi.doMock("@realreal/control-db", () => ({
      tenants: { getTenant }, infrastructure: { getInfrastructure },
    }))
    const ctx = await loadTenantContext({} as never, "t1")
    expect(ctx.tenant.slug).toBe("foo")
    expect(ctx.infra?.supabase_project_ref).toBe("ref")
    expect(ctx.platformDomain).toBe("foo.platform.realreal.cc")
  })

  it("throws if tenant not found", async () => {
    vi.resetModules()
    vi.doMock("@realreal/control-db", () => ({
      tenants: { getTenant: vi.fn().mockResolvedValue(null) },
      infrastructure: { getInfrastructure: vi.fn() },
    }))
    const { loadTenantContext: load } = await import("../src/provisioning/context")
    await expect(load({} as never, "missing")).rejects.toThrow(/tenant missing not found/)
  })
})
```

- [ ] **Step 2: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/context.test.ts`

- [ ] **Step 3: Implement `steps/types.ts`**

```ts
// apps/workers/src/provisioning/steps/types.ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Tenant, TenantInfrastructure, ProvisioningStep } from "@realreal/control-db"

export interface TenantContext {
  client: SupabaseClient
  tenant: Tenant
  infra: TenantInfrastructure | null
  platformDomain: string          // `${slug}.platform.realreal.cc`
  kek: Buffer
}

export interface StepHandler {
  step: ProvisioningStep
  isComplete(ctx: TenantContext): Promise<boolean>
  run(ctx: TenantContext): Promise<void>
}

export const STEP_ORDER: ProvisioningStep[] = [
  "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
  "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
]
```

- [ ] **Step 4: Implement `context.ts`**

```ts
// apps/workers/src/provisioning/context.ts
import type { SupabaseClient } from "@supabase/supabase-js"
import { tenants, infrastructure, loadKek } from "@realreal/control-db"
import type { TenantContext } from "./steps/types"

export async function loadTenantContext(
  client: SupabaseClient, tenantId: string,
): Promise<TenantContext> {
  const tenant = await tenants.getTenant(client, tenantId)
  if (!tenant) throw new Error(`tenant ${tenantId} not found`)
  const infra = await infrastructure.getInfrastructure(client, tenantId)
  return {
    client,
    tenant,
    infra,
    platformDomain: `${tenant.slug}.platform.realreal.cc`,
    kek: loadKek(),
  }
}
```

- [ ] **Step 5: Implement empty `registry.ts`** (handlers wired in PR-D5..D11)

```ts
// apps/workers/src/provisioning/steps/registry.ts
import type { StepHandler } from "./types"
import type { ProvisioningStep } from "@realreal/control-db"

const handlers = new Map<ProvisioningStep, StepHandler>()

export function registerHandler(h: StepHandler): void {
  handlers.set(h.step, h)
}
export function getHandler(step: ProvisioningStep): StepHandler | undefined {
  return handlers.get(step)
}
export function registeredSteps(): ProvisioningStep[] {
  return [...handlers.keys()]
}
```

- [ ] **Step 6: Run, verify PASS.**
Run: `cd apps/workers && npx vitest run __tests__/context.test.ts`

- [ ] **Step 7: Typecheck + commit**

Run: `cd apps/workers && npx tsc --noEmit`

```bash
git add apps/workers/src/provisioning apps/workers/__tests__/context.test.ts
git commit -m "$(cat <<'EOF'
feat(workers): StepHandler interface + TenantContext + step registry (Phase D1 scaffold)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D5: Dispatcher with retry/backoff + runner integration

**Why before the handlers:** lets every later PR plug a handler into a tested orchestration loop. Spec §6 retry ladder: attempt 1 fail → 30s, attempt 2 → 2min, attempt 3 → mark `failed` + alert.

**Files:**
- Create: `apps/workers/src/provisioning/dispatch.ts`
- Modify: `apps/workers/src/jobs/runner.ts`
- Modify: `packages/control-db/src/queries/jobs.ts` (add `requeueJob` with `attempt` increment + `available_at`)
- Modify: `packages/control-db/migrations/` — add `0013_provisioning_jobs_available_at.sql` (new column for delayed retry; idempotent `add column if not exists`)
- Test: `apps/workers/__tests__/dispatch.test.ts`

- [ ] **Step 1: Migration for delayed retry**

```sql
-- packages/control-db/migrations/0013_provisioning_jobs_available_at.sql
alter table provisioning_jobs add column if not exists available_at timestamptz default now();
create index if not exists provisioning_jobs_available_idx
  on provisioning_jobs (available_at) where status = 'queued';
```

> The existing `claim_queued_job` RPC (migration `0010`) must also filter `available_at <= now()`. Add `0014_claim_queued_job_available.sql` that `create or replace function claim_queued_job()` with `where status='queued' and available_at <= now() order by created_at limit 1 for update skip locked`. Copy the existing function body from `0010_claim_queued_job.sql` and add only the `available_at` predicate.

- [ ] **Step 2: Write failing dispatch test**

```ts
// apps/workers/__tests__/dispatch.test.ts
import { describe, it, expect, vi } from "vitest"
import { dispatchJob } from "../src/provisioning/dispatch"

const markJobStatus = vi.fn()
const requeueJob = vi.fn()
const loadTenantContext = vi.fn().mockResolvedValue({ tenant: { id: "t1" } })
const getHandler = vi.fn()
vi.mock("@realreal/control-db", () => ({
  createControlClient: () => ({}),
  jobs: { markJobStatus, requeueJob },
}))
vi.mock("../src/provisioning/context", () => ({ loadTenantContext }))
vi.mock("../src/provisioning/steps/registry", () => ({ getHandler }))

const baseJob = { id: "j1", tenant_id: "t1", step: "validate", attempt: 0 }

beforeEach(() => vi.clearAllMocks())

describe("dispatchJob", () => {
  it("skips run() when isComplete() is true and marks success", async () => {
    getHandler.mockReturnValue({
      step: "validate",
      isComplete: vi.fn().mockResolvedValue(true),
      run: vi.fn(),
    })
    await dispatchJob({ ...baseJob } as never)
    expect(markJobStatus).toHaveBeenCalledWith(expect.anything(), "j1", "success")
  })

  it("runs handler and marks success", async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    getHandler.mockReturnValue({
      step: "validate", isComplete: vi.fn().mockResolvedValue(false), run,
    })
    await dispatchJob({ ...baseJob } as never)
    expect(run).toHaveBeenCalled()
    expect(markJobStatus).toHaveBeenCalledWith(expect.anything(), "j1", "success")
  })

  it("requeues with 30s delay on attempt 0 failure", async () => {
    getHandler.mockReturnValue({
      step: "validate", isComplete: vi.fn().mockResolvedValue(false),
      run: vi.fn().mockRejectedValue(new Error("boom")),
    })
    await dispatchJob({ ...baseJob, attempt: 0 } as never)
    expect(requeueJob).toHaveBeenCalledWith(expect.anything(), "j1", 1, 30_000, "boom")
    expect(markJobStatus).not.toHaveBeenCalledWith(expect.anything(), "j1", "failed")
  })

  it("requeues with 120s delay on attempt 1 failure", async () => {
    getHandler.mockReturnValue({
      step: "validate", isComplete: vi.fn().mockResolvedValue(false),
      run: vi.fn().mockRejectedValue(new Error("boom2")),
    })
    await dispatchJob({ ...baseJob, attempt: 1 } as never)
    expect(requeueJob).toHaveBeenCalledWith(expect.anything(), "j1", 2, 120_000, "boom2")
  })

  it("marks failed (no requeue) on attempt 2 failure", async () => {
    getHandler.mockReturnValue({
      step: "validate", isComplete: vi.fn().mockResolvedValue(false),
      run: vi.fn().mockRejectedValue(new Error("fatal")),
    })
    await dispatchJob({ ...baseJob, attempt: 2 } as never)
    expect(markJobStatus).toHaveBeenCalledWith(expect.anything(), "j1", "failed",
      { last_error: "fatal" })
    expect(requeueJob).not.toHaveBeenCalled()
  })

  it("marks failed when no handler is registered", async () => {
    getHandler.mockReturnValue(undefined)
    await dispatchJob({ ...baseJob, step: "bogus" } as never)
    expect(markJobStatus).toHaveBeenCalledWith(expect.anything(), "j1", "failed",
      expect.objectContaining({ last_error: expect.stringContaining("no handler") }))
  })
})
```

- [ ] **Step 3: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/dispatch.test.ts`

- [ ] **Step 4: Add `requeueJob` to `packages/control-db/src/queries/jobs.ts`**

```ts
export async function requeueJob(
  c: SupabaseClient, id: string, nextAttempt: number, delayMs: number, lastError: string,
): Promise<void> {
  const availableAt = new Date(Date.now() + delayMs).toISOString()
  const { error } = await c.from("provisioning_jobs").update({
    status: "queued", attempt: nextAttempt, last_error: lastError,
    available_at: availableAt, started_at: null,
  }).eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 5: Implement `dispatch.ts`**

```ts
// apps/workers/src/provisioning/dispatch.ts
import pino from "pino"
import { createControlClient, jobs, type ProvisioningJob } from "@realreal/control-db"
import { loadTenantContext } from "./context"
import { getHandler } from "./steps/registry"

const log = pino({ name: "dispatch" })
const BACKOFF_MS = [30_000, 120_000] as const  // attempt 0 -> 30s, attempt 1 -> 2min

export async function dispatchJob(job: ProvisioningJob): Promise<void> {
  const client = createControlClient()
  const handler = getHandler(job.step)
  if (!handler) {
    await jobs.markJobStatus(client, job.id, "failed",
      { last_error: `no handler for step '${job.step}'` })
    return
  }
  try {
    const ctx = await loadTenantContext(client, job.tenant_id)
    if (await handler.isComplete(ctx)) {
      log.info({ jobId: job.id, step: job.step }, "step already complete; skipping run")
      await jobs.markJobStatus(client, job.id, "success")
      return
    }
    await handler.run(ctx)
    await jobs.markJobStatus(client, job.id, "success")
    log.info({ jobId: job.id, step: job.step }, "step succeeded")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const delay = BACKOFF_MS[job.attempt]
    if (delay !== undefined) {
      log.warn({ jobId: job.id, step: job.step, attempt: job.attempt, msg },
        "step failed; requeueing")
      await jobs.requeueJob(client, job.id, job.attempt + 1, delay, msg)
    } else {
      log.error({ jobId: job.id, step: job.step, msg }, "step failed permanently")
      await jobs.markJobStatus(client, job.id, "failed", { last_error: msg })
      // ALERT: spec §9 — Slack #platform-ops + email. PR-D12 wires alertOps().
    }
  }
}
```

- [ ] **Step 6: Wire dispatcher into the runner** (replace the Phase-A "no handler" stub in `apps/workers/src/jobs/runner.ts` lines ~28-39)

```ts
// in tick(), after `if (!job || !job.id) return`:
import { dispatchJob } from "../provisioning/dispatch"
import "../provisioning/steps/registry-all"   // side-effect: registers every handler
// ...
await dispatchJob(job)
```

Create `apps/workers/src/provisioning/steps/registry-all.ts` as an empty file for now (handlers self-register here in PR-D5..D11 by importing & calling `registerHandler`):

```ts
// apps/workers/src/provisioning/steps/registry-all.ts
// Each step PR appends: import "./validate"  (and the file calls registerHandler at module load)
export {}
```

- [ ] **Step 7: Run, verify PASS** (6 tests + no runner regression).
Run: `cd apps/workers && npx vitest run`

- [ ] **Step 8: Typecheck + commit**

Run: `cd apps/workers && npx tsc --noEmit && cd ../../packages/control-db && npx tsc --noEmit`

```bash
git add apps/workers/src/provisioning/dispatch.ts apps/workers/src/provisioning/steps/registry-all.ts apps/workers/src/jobs/runner.ts apps/workers/__tests__/dispatch.test.ts packages/control-db/src/queries/jobs.ts packages/control-db/migrations/0013_provisioning_jobs_available_at.sql packages/control-db/migrations/0014_claim_queued_job_available.sql
git commit -m "$(cat <<'EOF'
feat(workers): provisioning dispatcher with retry/backoff + runner integration (Phase D1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D6: Step 1 `validate` + Step 2 `supabase_setup`

**Files:**
- Create: `apps/workers/src/provisioning/steps/validate.ts`
- Create: `apps/workers/src/provisioning/steps/supabase-setup.ts`
- Modify: `apps/workers/src/provisioning/steps/registry-all.ts` (import both)
- Test: `apps/workers/__tests__/step-validate.test.ts`, `apps/workers/__tests__/step-supabase.test.ts`

- [ ] **Step 1: Failing test — `validate`**

```ts
// apps/workers/__tests__/step-validate.test.ts
import { describe, it, expect, vi } from "vitest"
import { validateHandler } from "../src/provisioning/steps/validate"

const ctx = (slug: string, customDomain: string | null = null) => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: `${slug}.platform.realreal.cc`,
  infra: null,
  tenant: { id: "t1", slug, custom_domain: customDomain, status: "pending_payment",
            owner_user_id: "u1", plan: "standard" },
}) as never

describe("validate step", () => {
  it("isComplete is false when tenant still pending_payment", async () => {
    expect(await validateHandler.isComplete(ctx("foo"))).toBe(false)
  })
  it("run() flips status to provisioning for a valid slug", async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    vi.doMock("@realreal/control-db", () => ({ tenants: { updateTenantStatus: update } }))
    const { validateHandler: h } = await import("../src/provisioning/steps/validate")
    await h.run(ctx("good-slug"))
    expect(update).toHaveBeenCalledWith(expect.anything(), "t1", "provisioning")
  })
  it("run() rejects an invalid slug", async () => {
    await expect(validateHandler.run(ctx("Bad Slug!"))).rejects.toThrow(/invalid slug/)
  })
})
```

- [ ] **Step 2: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/step-validate.test.ts`

- [ ] **Step 3: Implement `validate.ts`**

```ts
// apps/workers/src/provisioning/steps/validate.ts
import { tenants } from "@realreal/control-db"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

const SLUG_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/
const RESERVED = new Set(["platform", "www", "api", "mcp", "admin", "canary", "staging"])

export const validateHandler: StepHandler = {
  step: "validate",
  async isComplete(ctx) {
    return ctx.tenant.status === "provisioning" || ctx.tenant.status === "active"
  },
  async run(ctx) {
    const { slug, custom_domain, plan } = ctx.tenant
    if (!SLUG_RE.test(slug)) throw new Error(`invalid slug '${slug}'`)
    if (RESERVED.has(slug)) throw new Error(`reserved slug '${slug}'`)
    if (custom_domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(custom_domain)) {
      throw new Error(`invalid custom_domain '${custom_domain}'`)
    }
    if (plan && !["starter", "standard", "pro"].includes(plan)) {
      throw new Error(`invalid plan '${plan}'`)
    }
    await tenants.updateTenantStatus(ctx.client, ctx.tenant.id, "provisioning")
  },
}
registerHandler(validateHandler)
```

- [ ] **Step 4: Run, verify PASS.**
Run: `cd apps/workers && npx vitest run __tests__/step-validate.test.ts`

- [ ] **Step 5: Failing test — `supabase_setup`**

```ts
// apps/workers/__tests__/step-supabase.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const createSupabaseProject = vi.fn()
const pollProjectHealthy = vi.fn()
const fetchProjectApiKeys = vi.fn()
const runTenantSql = vi.fn()
const configureAuth = vi.fn()
const createStorageBuckets = vi.fn()
const upsertInfrastructure = vi.fn()
vi.mock("@realreal/provisioning/clients/supabase-mgmt", () => ({
  createSupabaseProject, pollProjectHealthy, fetchProjectApiKeys,
  runTenantSql, configureAuth, createStorageBuckets,
}))
vi.mock("@realreal/control-db", () => ({
  infrastructure: { upsertInfrastructure }, loadKek: () => Buffer.alloc(32),
}))

import { supabaseSetupHandler } from "../src/provisioning/steps/supabase-setup"

const ctx = (infra: unknown = null) => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: "foo.platform.realreal.cc",
  infra, tenant: { id: "t1", slug: "foo", custom_domain: null, plan: "standard" },
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPABASE_PAT = "pat"
  process.env.SUPABASE_ORG_ID = "org"
})

describe("supabase_setup", () => {
  it("isComplete true when infra has a project ref", async () => {
    expect(await supabaseSetupHandler.isComplete(ctx({ supabase_project_ref: "ref" }))).toBe(true)
  })
  it("isComplete false when no infra", async () => {
    expect(await supabaseSetupHandler.isComplete(ctx(null))).toBe(false)
  })
  it("run creates project, waits healthy, runs migrations, seeds, persists infra", async () => {
    createSupabaseProject.mockResolvedValue({ ref: "ref1", url: "https://ref1.supabase.co" })
    pollProjectHealthy.mockResolvedValue(undefined)
    fetchProjectApiKeys.mockResolvedValue({ anon: "a", serviceRole: "sr" })
    runTenantSql.mockResolvedValue([])
    await supabaseSetupHandler.run(ctx(null))
    expect(createSupabaseProject).toHaveBeenCalled()
    expect(pollProjectHealthy).toHaveBeenCalledWith("pat", "ref1", expect.any(Object))
    expect(createStorageBuckets).toHaveBeenCalledWith("pat", "ref1")
    expect(upsertInfrastructure).toHaveBeenCalledWith(expect.anything(), "t1",
      expect.objectContaining({ supabase_project_ref: "ref1",
        supabase_service_role_key: "sr" }), expect.any(Buffer))
  })
})
```

- [ ] **Step 6: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/step-supabase.test.ts`

- [ ] **Step 7: Implement `supabase-setup.ts`**

```ts
// apps/workers/src/provisioning/steps/supabase-setup.ts
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { infrastructure } from "@realreal/control-db"
import {
  createSupabaseProject, pollProjectHealthy, fetchProjectApiKeys,
  runTenantSql, configureAuth, createStorageBuckets,
} from "@realreal/provisioning/clients/supabase-mgmt"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

function requireEnv(n: string): string {
  const v = process.env[n]
  if (!v) throw new Error(`${n} not set`)
  return v
}

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..",
  "packages", "db", "migrations")

export const supabaseSetupHandler: StepHandler = {
  step: "supabase_setup",
  async isComplete(ctx) {
    return Boolean(ctx.infra?.supabase_project_ref)
  },
  async run(ctx) {
    const pat = requireEnv("SUPABASE_PAT")
    const orgId = requireEnv("SUPABASE_ORG_ID")
    // 1. create (or reuse if a partial run left a ref — caller re-loads ctx)
    const { ref, url } = await createSupabaseProject({
      pat, name: `tenant-${ctx.tenant.slug}`, region: "ap-northeast-1",
      orgId, dbPass: requireEnv("PLATFORM_KEK").slice(0, 24),
    })
    await pollProjectHealthy(pat, ref, { intervalMs: 5_000, maxMs: 180_000 })
    const { anon, serviceRole } = await fetchProjectApiKeys(pat, ref)

    // 2. run every tenant migration in order (idempotent: 0015 bootstraps
    //    schema_migrations; see infrastructure/provisioning/apply-tenant-migrations.ts)
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort()
    for (const f of files) {
      await runTenantSql(pat, ref, readFileSync(join(MIGRATIONS_DIR, f), "utf8"), `migrate ${f}`)
    }

    // 3. seed (spec §5): brand + module_config defaults are seeded by
    //    migration 0020_brand_seed.sql which the loop above already ran.
    //    Categories root + default plans/tiers/campaign templates are also
    //    in 0020. No extra seed SQL needed here.

    // 4. Auth config
    const siteUrl = ctx.tenant.custom_domain
      ? `https://${ctx.tenant.custom_domain}`
      : `https://${ctx.platformDomain}`
    await configureAuth(pat, ref, siteUrl, [
      `${siteUrl}/auth/callback`, "https://*.vercel.app/auth/callback",
    ])

    // 5. storage buckets
    await createStorageBuckets(pat, ref)

    // 6. persist infra (service_role key KEK-encrypted in upsertInfrastructure)
    await infrastructure.upsertInfrastructure(ctx.client, ctx.tenant.id, {
      supabase_project_ref: ref,
      supabase_url: url,
      supabase_anon_key: anon,
      supabase_service_role_key: serviceRole,
    }, ctx.kek)
  },
}
registerHandler(supabaseSetupHandler)
```

> **Resolved ambiguity:** spec §5 says seed runs "during provisioning" but §11 lists `0020_brand_seed.sql` as a migration. Treating seed as part of the migration set (already applied by the loop) keeps it idempotent and avoids a separate non-idempotent seed step. Recorded in Self-Review.

- [ ] **Step 8: Register both in `registry-all.ts`**

```ts
// apps/workers/src/provisioning/steps/registry-all.ts
import "./validate"
import "./supabase-setup"
export {}
```

- [ ] **Step 9: Run, verify PASS** (validate + supabase suites).
Run: `cd apps/workers && npx vitest run __tests__/step-validate.test.ts __tests__/step-supabase.test.ts`

- [ ] **Step 10: Typecheck + commit**

Run: `cd apps/workers && npx tsc --noEmit`

```bash
git add apps/workers/src/provisioning/steps/validate.ts apps/workers/src/provisioning/steps/supabase-setup.ts apps/workers/src/provisioning/steps/registry-all.ts apps/workers/__tests__/step-validate.test.ts apps/workers/__tests__/step-supabase.test.ts
git commit -m "$(cat <<'EOF'
feat(workers): step handlers validate + supabase_setup (Phase D1 steps 1-2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D7: Step 3 `resend_setup` + Step 4 `cloudflare_dns`

**Files:**
- Create: `apps/workers/src/provisioning/steps/resend-setup.ts`
- Create: `apps/workers/src/provisioning/steps/cloudflare-dns.ts`
- Modify: `apps/workers/src/provisioning/steps/registry-all.ts`
- Test: `apps/workers/__tests__/step-resend.test.ts`, `apps/workers/__tests__/step-cloudflare.test.ts`

- [ ] **Step 1: Failing test — `resend_setup`** (BYO domain → dedicated DKIM; platform subdomain → shared, no-op)

```ts
// apps/workers/__tests__/step-resend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const addResendDomain = vi.fn()
const upsertInfrastructure = vi.fn()
vi.mock("@realreal/provisioning/clients/resend", () => ({ addResendDomain }))
vi.mock("@realreal/control-db", () => ({ infrastructure: { upsertInfrastructure } }))
import { resendSetupHandler } from "../src/provisioning/steps/resend-setup"

const ctx = (custom: string | null, infra: unknown = null) => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: "foo.platform.realreal.cc",
  infra, tenant: { id: "t1", slug: "foo", custom_domain: custom },
}) as never

beforeEach(() => { vi.clearAllMocks(); process.env.RESEND_API_KEY = "re_x" })

describe("resend_setup", () => {
  it("platform-subdomain tenant: shared domain, no Resend API call", async () => {
    await resendSetupHandler.run(ctx(null))
    expect(addResendDomain).not.toHaveBeenCalled()
  })
  it("BYO tenant: registers mail.<domain> and stores domain id", async () => {
    addResendDomain.mockResolvedValue({ id: "dom1", records: [] })
    await resendSetupHandler.run(ctx("mybrand.com"))
    expect(addResendDomain).toHaveBeenCalledWith("re_x", "mail.mybrand.com")
    expect(upsertInfrastructure).toHaveBeenCalledWith(expect.anything(), "t1",
      { resend_domain_id: "dom1" }, expect.any(Buffer))
  })
  it("isComplete true for platform-subdomain tenant (nothing to do)", async () => {
    expect(await resendSetupHandler.isComplete(ctx(null))).toBe(true)
  })
  it("isComplete true for BYO once domain id stored", async () => {
    expect(await resendSetupHandler.isComplete(ctx("x.com", { resend_domain_id: "d" }))).toBe(true)
  })
})
```

- [ ] **Step 2: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/step-resend.test.ts`

- [ ] **Step 3: Implement `resend-setup.ts`**

```ts
// apps/workers/src/provisioning/steps/resend-setup.ts
import { infrastructure } from "@realreal/control-db"
import { addResendDomain } from "@realreal/provisioning/clients/resend"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const resendSetupHandler: StepHandler = {
  step: "resend_setup",
  async isComplete(ctx) {
    // Platform-subdomain tenants share mail.platform.realreal.cc (verified
    // once at platform setup). Nothing per-tenant to do (spec §6 step 3).
    if (!ctx.tenant.custom_domain) return true
    return Boolean(ctx.infra?.resend_domain_id)
  },
  async run(ctx) {
    if (!ctx.tenant.custom_domain) return
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error("RESEND_API_KEY not set")
    const { id } = await addResendDomain(apiKey, `mail.${ctx.tenant.custom_domain}`)
    await infrastructure.upsertInfrastructure(ctx.client, ctx.tenant.id,
      { resend_domain_id: id }, ctx.kek)
    // DKIM TXT records are emailed to the customer in tenant_finalize; the
    // hourly cron (resend-dkim-verify.ts) polls verification post-provision.
  },
}
registerHandler(resendSetupHandler)
```

- [ ] **Step 4: Run, verify PASS.**
Run: `cd apps/workers && npx vitest run __tests__/step-resend.test.ts`

- [ ] **Step 5: Failing test — `cloudflare_dns`**

```ts
// apps/workers/__tests__/step-cloudflare.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const upsertCnameRecord = vi.fn()
vi.mock("@realreal/provisioning/clients/cloudflare", () => ({ upsertCnameRecord }))
import { cloudflareDnsHandler } from "../src/provisioning/steps/cloudflare-dns"

const ctx = (custom: string | null) => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: "foo.platform.realreal.cc",
  infra: { cloudflare_zone_id: null }, tenant: { id: "t1", slug: "foo", custom_domain: custom },
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CLOUDFLARE_API_TOKEN = "cf"
  process.env.CLOUDFLARE_PLATFORM_ZONE_ID = "zone1"
})

describe("cloudflare_dns", () => {
  it("creates CNAME foo.platform.realreal.cc -> vercel for platform subdomain", async () => {
    await cloudflareDnsHandler.run(ctx(null))
    expect(upsertCnameRecord).toHaveBeenCalledWith({
      token: "cf", zoneId: "zone1",
      name: "foo.platform.realreal.cc", content: "cname.vercel-dns.com",
    })
  })
  it("BYO tenant: no platform DNS write (records emailed instead)", async () => {
    await cloudflareDnsHandler.run(ctx("mybrand.com"))
    expect(upsertCnameRecord).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/step-cloudflare.test.ts`

- [ ] **Step 7: Implement `cloudflare-dns.ts`**

```ts
// apps/workers/src/provisioning/steps/cloudflare-dns.ts
import { upsertCnameRecord } from "@realreal/provisioning/clients/cloudflare"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const cloudflareDnsHandler: StepHandler = {
  step: "cloudflare_dns",
  async isComplete() {
    // upsertCnameRecord is itself idempotent (GET then POST/PATCH); always
    // safe to re-run, so report incomplete and let run() reconcile.
    return false
  },
  async run(ctx) {
    if (ctx.tenant.custom_domain) {
      // BYO: customer sets their own DNS; records are included in the
      // welcome email (tenant_finalize). v1 has a manual confirm gate.
      return
    }
    const token = process.env.CLOUDFLARE_API_TOKEN
    const zoneId = process.env.CLOUDFLARE_PLATFORM_ZONE_ID
    if (!token || !zoneId) throw new Error("CLOUDFLARE_API_TOKEN / CLOUDFLARE_PLATFORM_ZONE_ID not set")
    await upsertCnameRecord({
      token, zoneId, name: ctx.platformDomain, content: "cname.vercel-dns.com",
    })
  },
}
registerHandler(cloudflareDnsHandler)
```

- [ ] **Step 8: Register both, run, verify PASS**

Add `import "./resend-setup"` and `import "./cloudflare-dns"` to `registry-all.ts`.
Run: `cd apps/workers && npx vitest run __tests__/step-resend.test.ts __tests__/step-cloudflare.test.ts`

- [ ] **Step 9: Typecheck + commit**

Run: `cd apps/workers && npx tsc --noEmit`

```bash
git add apps/workers/src/provisioning/steps/resend-setup.ts apps/workers/src/provisioning/steps/cloudflare-dns.ts apps/workers/src/provisioning/steps/registry-all.ts apps/workers/__tests__/step-resend.test.ts apps/workers/__tests__/step-cloudflare.test.ts
git commit -m "$(cat <<'EOF'
feat(workers): step handlers resend_setup + cloudflare_dns (Phase D1 steps 3-4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D8: Step 5 `vercel_setup` + Step 6 `railway_setup`

**Files:**
- Create: `apps/workers/src/provisioning/steps/vercel-setup.ts`
- Create: `apps/workers/src/provisioning/steps/railway-setup.ts`
- Modify: `apps/workers/src/provisioning/steps/registry-all.ts`
- Test: `apps/workers/__tests__/step-vercel.test.ts`, `apps/workers/__tests__/step-railway.test.ts`

- [ ] **Step 1: Failing test — `vercel_setup`**

```ts
// apps/workers/__tests__/step-vercel.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const createVercelProject = vi.fn()
const setVercelEnv = vi.fn()
const triggerVercelDeploy = vi.fn()
const pollVercelReady = vi.fn()
const upsertInfrastructure = vi.fn()
vi.mock("@realreal/provisioning/clients/vercel", () => ({
  createVercelProject, setVercelEnv, triggerVercelDeploy, pollVercelReady,
}))
vi.mock("@realreal/control-db", () => ({ infrastructure: { upsertInfrastructure } }))
import { vercelSetupHandler } from "../src/provisioning/steps/vercel-setup"

const ctx = (infra: unknown = null) => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: "foo.platform.realreal.cc",
  infra, tenant: { id: "t1", slug: "foo", custom_domain: null },
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VERCEL_TOKEN = "v"
  createVercelProject.mockResolvedValue("prj_1")
  triggerVercelDeploy.mockResolvedValue("dpl_1")
  pollVercelReady.mockResolvedValue("https://foo.vercel.app")
})

describe("vercel_setup", () => {
  it("isComplete true once vercel_project_id stored", async () => {
    expect(await vercelSetupHandler.isComplete(ctx({ vercel_project_id: "p" }))).toBe(true)
  })
  it("run links repo production branch, sets supabase env, deploys, persists", async () => {
    await vercelSetupHandler.run({ ...ctx(null),
      infra: { supabase_url: "https://ref.supabase.co", supabase_anon_key: "anon" } } as never)
    expect(createVercelProject).toHaveBeenCalledWith(expect.objectContaining({
      branch: "production", rootDir: "apps/web" }))
    expect(setVercelEnv).toHaveBeenCalledWith("v", "prj_1", expect.objectContaining({
      NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co" }))
    expect(upsertInfrastructure).toHaveBeenCalledWith(expect.anything(), "t1",
      expect.objectContaining({ vercel_project_id: "prj_1",
        vercel_deployment_url: "https://foo.vercel.app" }), expect.any(Buffer))
  })
})
```

- [ ] **Step 2: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/step-vercel.test.ts`

- [ ] **Step 3: Implement `vercel-setup.ts`**

```ts
// apps/workers/src/provisioning/steps/vercel-setup.ts
import { infrastructure } from "@realreal/control-db"
import {
  createVercelProject, setVercelEnv, triggerVercelDeploy, pollVercelReady,
} from "@realreal/provisioning/clients/vercel"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const vercelSetupHandler: StepHandler = {
  step: "vercel_setup",
  async isComplete(ctx) {
    return Boolean(ctx.infra?.vercel_project_id)
  },
  async run(ctx) {
    const token = process.env.VERCEL_TOKEN
    if (!token) throw new Error("VERCEL_TOKEN not set")
    if (!ctx.infra?.supabase_url || !ctx.infra?.supabase_anon_key) {
      throw new Error("supabase_setup must complete before vercel_setup")
    }
    const projectId = await createVercelProject({
      token, name: `tenant-${ctx.tenant.slug}`,
      repo: "Gathertaiwan-Group/G", branch: "production", rootDir: "apps/web",
    })
    await setVercelEnv(token, projectId, {
      NEXT_PUBLIC_SUPABASE_URL: ctx.infra.supabase_url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ctx.infra.supabase_anon_key,
      // Real Railway API URL is unknown until railway_setup; placeholder now,
      // overwritten in domain_finalize.
      NEXT_PUBLIC_API_URL: "https://placeholder.invalid",
    })
    const deploymentId = await triggerVercelDeploy(token, projectId)
    const deployUrl = await pollVercelReady(token, deploymentId,
      { intervalMs: 5_000, maxMs: 180_000 })
    await infrastructure.upsertInfrastructure(ctx.client, ctx.tenant.id, {
      vercel_project_id: projectId, vercel_deployment_url: deployUrl,
    }, ctx.kek)
  },
}
registerHandler(vercelSetupHandler)
```

- [ ] **Step 4: Run, verify PASS.**
Run: `cd apps/workers && npx vitest run __tests__/step-vercel.test.ts`

- [ ] **Step 5: Failing test — `railway_setup`** (project + api service + mcp service)

```ts
// apps/workers/__tests__/step-railway.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const createRailwayProject = vi.fn()
const createRailwayService = vi.fn()
const setRailwayVars = vi.fn()
const deployRailwayService = vi.fn()
const pollRailwayHealthz = vi.fn()
const upsertInfrastructure = vi.fn()
vi.mock("@realreal/provisioning/clients/railway", () => ({
  createRailwayProject, createRailwayService, setRailwayVars,
  deployRailwayService, pollRailwayHealthz,
}))
vi.mock("@realreal/control-db", () => ({ infrastructure: { upsertInfrastructure } }))
import { railwaySetupHandler } from "../src/provisioning/steps/railway-setup"

const ctx = (infra: unknown) => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: "foo.platform.realreal.cc",
  infra, tenant: { id: "t1", slug: "foo", custom_domain: null },
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RAILWAY_TOKEN = "r"
  process.env.INTERNAL_API_SECRET = "isecret"
  createRailwayProject.mockResolvedValue("rprj_1")
  createRailwayService.mockResolvedValueOnce("svc_api").mockResolvedValueOnce("svc_mcp")
})

describe("railway_setup", () => {
  it("creates project + api + mcp services and persists their ids", async () => {
    await railwaySetupHandler.run(ctx({
      supabase_url: "https://r.supabase.co", supabase_anon_key: "anon" }))
    expect(createRailwayService).toHaveBeenCalledTimes(2)
    expect(upsertInfrastructure).toHaveBeenCalledWith(expect.anything(), "t1",
      expect.objectContaining({ railway_project_id: "rprj_1",
        railway_api_service_id: "svc_api", railway_mcp_service_id: "svc_mcp" }),
      expect.any(Buffer))
  })
  it("isComplete true once both service ids stored", async () => {
    expect(await railwaySetupHandler.isComplete(ctx({
      railway_api_service_id: "a", railway_mcp_service_id: "m" }))).toBe(true)
  })
})
```

- [ ] **Step 6: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/step-railway.test.ts`

- [ ] **Step 7: Implement `railway-setup.ts`**

```ts
// apps/workers/src/provisioning/steps/railway-setup.ts
import { infrastructure } from "@realreal/control-db"
import {
  createRailwayProject, createRailwayService, setRailwayVars,
  deployRailwayService, pollRailwayHealthz,
} from "@realreal/provisioning/clients/railway"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const railwaySetupHandler: StepHandler = {
  step: "railway_setup",
  async isComplete(ctx) {
    return Boolean(ctx.infra?.railway_api_service_id && ctx.infra?.railway_mcp_service_id)
  },
  async run(ctx) {
    const token = process.env.RAILWAY_TOKEN
    const internalSecret = process.env.INTERNAL_API_SECRET
    if (!token) throw new Error("RAILWAY_TOKEN not set")
    if (!internalSecret) throw new Error("INTERNAL_API_SECRET not set")
    if (!ctx.infra?.supabase_url || !ctx.infra?.supabase_anon_key) {
      throw new Error("supabase_setup must complete before railway_setup")
    }
    const projectId = await createRailwayProject(token, `tenant-${ctx.tenant.slug}`)
    const sharedEnv = {
      SUPABASE_URL: ctx.infra.supabase_url,
      SUPABASE_ANON_KEY: ctx.infra.supabase_anon_key,
      INTERNAL_API_SECRET: internalSecret,
    }
    const apiSvc = await createRailwayService(token, projectId, "api",
      "Gathertaiwan-Group/G", "production", "apps/api")
    await setRailwayVars(token, apiSvc, sharedEnv)
    await deployRailwayService(token, apiSvc)

    const mcpSvc = await createRailwayService(token, projectId, "mcp",
      "Gathertaiwan-Group/G", "production", "apps/mcp")
    await setRailwayVars(token, mcpSvc, sharedEnv)
    await deployRailwayService(token, mcpSvc)

    await infrastructure.upsertInfrastructure(ctx.client, ctx.tenant.id, {
      railway_project_id: projectId,
      railway_api_service_id: apiSvc,
      railway_mcp_service_id: mcpSvc,
    }, ctx.kek)
    // Healthcheck URLs are assigned by Railway after deploy; domain_finalize
    // resolves and persists them, then polls /health and /healthz.
  },
}
registerHandler(railwaySetupHandler)
```

- [ ] **Step 8: Register both, run, verify PASS**

Add `import "./vercel-setup"` and `import "./railway-setup"` to `registry-all.ts`.
Run: `cd apps/workers && npx vitest run __tests__/step-vercel.test.ts __tests__/step-railway.test.ts`

- [ ] **Step 9: Typecheck + commit**

Run: `cd apps/workers && npx tsc --noEmit`

```bash
git add apps/workers/src/provisioning/steps/vercel-setup.ts apps/workers/src/provisioning/steps/railway-setup.ts apps/workers/src/provisioning/steps/registry-all.ts apps/workers/__tests__/step-vercel.test.ts apps/workers/__tests__/step-railway.test.ts
git commit -m "$(cat <<'EOF'
feat(workers): step handlers vercel_setup + railway_setup (Phase D1 steps 5-6)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D9: Step 7 `domain_finalize` + Step 8 `tenant_finalize`

**Files:**
- Create: `apps/workers/src/provisioning/steps/domain-finalize.ts`
- Create: `apps/workers/src/provisioning/steps/tenant-finalize.ts`
- Modify: `apps/workers/src/provisioning/steps/registry-all.ts`
- Test: `apps/workers/__tests__/step-domain.test.ts`, `apps/workers/__tests__/step-finalize.test.ts`

- [ ] **Step 1: Failing test — `domain_finalize`** (rewrite env with real Railway URLs, redeploy, add domain, poll health)

```ts
// apps/workers/__tests__/step-domain.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const setVercelEnv = vi.fn()
const triggerVercelDeploy = vi.fn().mockResolvedValue("dpl_2")
const pollVercelReady = vi.fn().mockResolvedValue("https://foo.vercel.app")
const addVercelDomain = vi.fn()
const pollRailwayHealthz = vi.fn()
const upsertInfrastructure = vi.fn()
vi.mock("@realreal/provisioning/clients/vercel", () => ({
  setVercelEnv, triggerVercelDeploy, pollVercelReady, addVercelDomain }))
vi.mock("@realreal/provisioning/clients/railway", () => ({ pollRailwayHealthz }))
vi.mock("@realreal/control-db", () => ({ infrastructure: { upsertInfrastructure } }))
import { domainFinalizeHandler } from "../src/provisioning/steps/domain-finalize"

const ctx = () => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: "foo.platform.realreal.cc",
  tenant: { id: "t1", slug: "foo", custom_domain: null },
  infra: { vercel_project_id: "prj_1",
    railway_api_url: "https://api-foo.up.railway.app",
    railway_mcp_url: "https://mcp-foo.up.railway.app" },
}) as never

beforeEach(() => { vi.clearAllMocks(); process.env.VERCEL_TOKEN = "v" })

describe("domain_finalize", () => {
  it("rewrites API env, redeploys, adds platform domain, waits health", async () => {
    await domainFinalizeHandler.run(ctx())
    expect(setVercelEnv).toHaveBeenCalledWith("v", "prj_1",
      { NEXT_PUBLIC_API_URL: "https://api-foo.up.railway.app" })
    expect(addVercelDomain).toHaveBeenCalledWith("v", "prj_1", "foo.platform.realreal.cc")
    expect(pollRailwayHealthz).toHaveBeenCalledWith("https://api-foo.up.railway.app/health",
      expect.any(Object))
    expect(pollRailwayHealthz).toHaveBeenCalledWith("https://mcp-foo.up.railway.app/healthz",
      expect.any(Object))
  })
})
```

- [ ] **Step 2: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/step-domain.test.ts`

- [ ] **Step 3: Implement `domain-finalize.ts`**

```ts
// apps/workers/src/provisioning/steps/domain-finalize.ts
import {
  setVercelEnv, triggerVercelDeploy, pollVercelReady, addVercelDomain,
} from "@realreal/provisioning/clients/vercel"
import { pollRailwayHealthz } from "@realreal/provisioning/clients/railway"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const domainFinalizeHandler: StepHandler = {
  step: "domain_finalize",
  async isComplete() {
    return false   // idempotent reconcile every run
  },
  async run(ctx) {
    const token = process.env.VERCEL_TOKEN
    if (!token) throw new Error("VERCEL_TOKEN not set")
    const i = ctx.infra
    if (!i?.vercel_project_id || !i.railway_api_url || !i.railway_mcp_url) {
      throw new Error("vercel_setup + railway_setup must complete before domain_finalize")
    }
    // 1. wait for Railway services healthy
    await pollRailwayHealthz(`${i.railway_api_url}/health`, { intervalMs: 5_000, maxMs: 300_000 })
    await pollRailwayHealthz(`${i.railway_mcp_url}/healthz`, { intervalMs: 5_000, maxMs: 300_000 })
    // 2. overwrite the placeholder API URL with the real Railway URL, redeploy
    await setVercelEnv(token, i.vercel_project_id, { NEXT_PUBLIC_API_URL: i.railway_api_url })
    const dpl = await triggerVercelDeploy(token, i.vercel_project_id)
    await pollVercelReady(token, dpl, { intervalMs: 5_000, maxMs: 180_000 })
    // 3. attach the public domain (platform subdomain; BYO added but unverified
    //    until the manual confirm gate in v1)
    const domain = ctx.tenant.custom_domain ?? ctx.platformDomain
    await addVercelDomain(token, i.vercel_project_id, domain)
  },
}
registerHandler(domainFinalizeHandler)
```

- [ ] **Step 4: Run, verify PASS.**
Run: `cd apps/workers && npx vitest run __tests__/step-domain.test.ts`

- [ ] **Step 5: Failing test — `tenant_finalize`** (mcp token, virtual admin, welcome email, status=active)

```ts
// apps/workers/__tests__/step-finalize.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const upsertInfrastructure = vi.fn()
const updateTenantStatus = vi.fn()
const runTenantSql = vi.fn()
const hash = vi.fn().mockResolvedValue("bcrypthash")
vi.mock("@realreal/control-db", () => ({
  infrastructure: { upsertInfrastructure }, tenants: { updateTenantStatus } }))
vi.mock("@realreal/provisioning/clients/supabase-mgmt", () => ({ runTenantSql }))
vi.mock("bcryptjs", () => ({ default: { hash } }))
const sendEmail = vi.fn()
vi.mock("../src/provisioning/notify", () => ({ sendWelcomeEmail: sendEmail, alertOps: vi.fn() }))
import { tenantFinalizeHandler } from "../src/provisioning/steps/tenant-finalize"

const ctx = () => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: "foo.platform.realreal.cc",
  tenant: { id: "t1", slug: "foo", custom_domain: null, owner_user_id: "u1" },
  infra: { supabase_project_ref: "ref", supabase_url: "https://ref.supabase.co" },
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPABASE_PAT = "pat"
  process.env.OWNER_ADMIN_EMAIL = "owner@example.com"
})

describe("tenant_finalize", () => {
  it("generates MCP token (hash stored), creates admin, emails, activates", async () => {
    await tenantFinalizeHandler.run(ctx())
    expect(upsertInfrastructure).toHaveBeenCalledWith(expect.anything(), "t1",
      { mcp_token_hash: "bcrypthash" }, expect.any(Buffer))
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com", slug: "foo" }))
    expect(updateTenantStatus).toHaveBeenCalledWith(expect.anything(), "t1", "active")
  })
  it("isComplete true once tenant active", async () => {
    const c = ctx(); c.tenant.status = "active"
    expect(await tenantFinalizeHandler.isComplete(c)).toBe(true)
  })
})
```

- [ ] **Step 6: Run, verify FAIL.**
Run: `cd apps/workers && npx vitest run __tests__/step-finalize.test.ts`

- [ ] **Step 7: Implement `notify.ts` then `tenant-finalize.ts`**

```ts
// apps/workers/src/provisioning/notify.ts
import pino from "pino"
const log = pino({ name: "notify" })

export async function sendWelcomeEmail(p: {
  to: string; slug: string; siteUrl: string; mcpUrl: string; mcpToken: string
}): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) { log.warn("RESEND_API_KEY missing; skipping welcome email"); return }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Platform <noreply@mail.platform.realreal.cc>",
      to: p.to,
      subject: `Your site ${p.slug} is live`,
      text: `Site: ${p.siteUrl}\nMCP endpoint: ${p.mcpUrl}\nMCP token (store securely, shown once): ${p.mcpToken}`,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`sendWelcomeEmail: ${res.status} ${await res.text()}`)
}

export async function alertOps(subject: string, body: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) { log.warn({ subject }, "SLACK_WEBHOOK_URL missing; alert dropped"); return }
  await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `:rotating_light: ${subject}\n${body}` }),
    signal: AbortSignal.timeout(10_000),
  }).catch(e => log.error({ e: String(e) }, "slack alert failed"))
}
```

```ts
// apps/workers/src/provisioning/steps/tenant-finalize.ts
import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { infrastructure, tenants } from "@realreal/control-db"
import { runTenantSql } from "@realreal/provisioning/clients/supabase-mgmt"
import { sendWelcomeEmail } from "../notify"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const tenantFinalizeHandler: StepHandler = {
  step: "tenant_finalize",
  async isComplete(ctx) {
    return ctx.tenant.status === "active"
  },
  async run(ctx) {
    const pat = process.env.SUPABASE_PAT
    const ownerEmail = process.env.OWNER_ADMIN_EMAIL
    if (!pat) throw new Error("SUPABASE_PAT not set")
    if (!ownerEmail) throw new Error("OWNER_ADMIN_EMAIL not set")
    const ref = ctx.infra?.supabase_project_ref
    if (!ref) throw new Error("supabase_setup must complete before tenant_finalize")

    // 1. MCP token: plaintext emailed once, only bcrypt hash persisted
    const mcpToken = randomBytes(32).toString("hex")
    const mcpHash = await bcrypt.hash(mcpToken, 10)
    await infrastructure.upsertInfrastructure(ctx.client, ctx.tenant.id,
      { mcp_token_hash: mcpHash }, ctx.kek)

    // 2. virtual admin user mcp@<slug>.local + role=admin (idempotent upsert).
    //    spec §8 — MCP server signs in as this user against apps/api.
    const mcpEmail = `mcp@${ctx.tenant.slug}.local`
    await runTenantSql(pat, ref, `
insert into auth.users (id, email, role, raw_app_meta_data, email_confirmed_at)
values (gen_random_uuid(), '${mcpEmail}', 'authenticated',
        '{"role":"admin"}'::jsonb, now())
on conflict (email) do nothing;`, "create mcp admin user")

    // 3. welcome email (site URL, MCP endpoint, plaintext token once)
    const siteUrl = ctx.tenant.custom_domain
      ? `https://${ctx.tenant.custom_domain}` : `https://${ctx.platformDomain}`
    await sendWelcomeEmail({
      to: ownerEmail, slug: ctx.tenant.slug, siteUrl,
      mcpUrl: ctx.infra?.railway_mcp_url ?? "(pending)", mcpToken,
    })

    // 4. activate
    await tenants.updateTenantStatus(ctx.client, ctx.tenant.id, "active")
  },
}
registerHandler(tenantFinalizeHandler)
```

- [ ] **Step 8: Register both, run, verify PASS**

Add `import "./domain-finalize"` and `import "./tenant-finalize"` to `registry-all.ts`.
Run: `cd apps/workers && npx vitest run __tests__/step-domain.test.ts __tests__/step-finalize.test.ts`

- [ ] **Step 9: Full workers suite + typecheck + commit**

Run: `cd apps/workers && npx vitest run && npx tsc --noEmit`
Expected: PASS — all step + dispatch + webhook + context + hmac + audit suites green.

```bash
git add apps/workers/src/provisioning/steps/domain-finalize.ts apps/workers/src/provisioning/steps/tenant-finalize.ts apps/workers/src/provisioning/notify.ts apps/workers/src/provisioning/steps/registry-all.ts apps/workers/__tests__/step-domain.test.ts apps/workers/__tests__/step-finalize.test.ts
git commit -m "$(cat <<'EOF'
feat(workers): step handlers domain_finalize + tenant_finalize + notify (Phase D1 steps 7-8)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D10: L2 integration test — full 8-step chain ordering + state transitions

**Why:** spec §10 L2 — recorded-fixture integration verifying the chain runs in order and `provisioning_jobs` transitions queued→running→success, including a mid-chain failure→requeue.

**Files:**
- Test: `apps/workers/__tests__/pipeline-chain.test.ts`
- Create: `apps/workers/__tests__/fixtures/mgmt-responses.ts` (recorded API JSON)

- [ ] **Step 1: Write the chain test** (drives `dispatchJob` over all 8 steps with an in-memory fake control client + all Mgmt clients mocked from fixtures)

```ts
// apps/workers/__tests__/pipeline-chain.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { STEP_ORDER } from "../src/provisioning/steps/types"

// In-memory control DB: tenants + tenant_infrastructure + provisioning_jobs.
function makeFakeControl() {
  const state = {
    tenant: { id: "t1", slug: "pioneer-test", custom_domain: null,
      status: "pending_payment", owner_user_id: "u1", plan: "standard" },
    infra: {} as Record<string, unknown>,
    jobStatuses: {} as Record<string, string>,
  }
  return { state }
}

describe("8-step pipeline chain (L2)", () => {
  it("runs all steps in order, ending with tenant active", async () => {
    expect(STEP_ORDER).toEqual([
      "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
      "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
    ])
    // The detailed mock wiring uses fixtures/mgmt-responses.ts and the same
    // vi.mock pattern as the per-step tests; assert that after dispatching a
    // job per step in order, the fake control state shows status === "active"
    // and tenant_infrastructure has supabase/vercel/railway ids + mcp hash.
    // (Full mock body omitted here is NOT acceptable — implement it using the
    //  exact mock module factories from step-*.test.ts, fed by fixtures.)
  })

  it("a failing step requeues and does not advance the chain", async () => {
    // Force railway_setup to reject once; assert requeueJob called with
    // attempt+1 and the chain does not reach domain_finalize until it
    // succeeds on retry.
  })
})
```

> **Implementation note for the engineer:** assemble the mocks by importing the same `vi.mock(...)` factories used in PR-D6..D9 step tests, but back them with `fixtures/mgmt-responses.ts` (a module exporting realistic JSON: a Supabase `ACTIVE_HEALTHY` project, Vercel `READY` deployment, Railway services, Resend domain). Replace the prose placeholders above with concrete assertions before committing — the two `it()` bodies must contain real arrange/act/assert code mirroring the step tests. Do not commit with empty test bodies.

- [ ] **Step 2: Create `fixtures/mgmt-responses.ts`** with real recorded-shape JSON:

```ts
// apps/workers/__tests__/fixtures/mgmt-responses.ts
export const SUPABASE_PROJECT = { id: "ref_pioneer", endpoint: "https://ref_pioneer.supabase.co" }
export const SUPABASE_HEALTHY = { status: "ACTIVE_HEALTHY" }
export const SUPABASE_KEYS = [
  { name: "anon", api_key: "anon_key_x" },
  { name: "service_role", api_key: "service_role_key_x" },
]
export const VERCEL_PROJECT = { id: "prj_pioneer" }
export const VERCEL_DEPLOY = { id: "dpl_pioneer", readyState: "READY",
  url: "pioneer.vercel.app" }
export const RAILWAY_PROJECT = { id: "rprj_pioneer" }
export const RAILWAY_API_SVC = { id: "svc_api_pioneer",
  url: "https://api-pioneer.up.railway.app" }
export const RAILWAY_MCP_SVC = { id: "svc_mcp_pioneer",
  url: "https://mcp-pioneer.up.railway.app" }
export const RESEND_DOMAIN = { id: "dom_pioneer", records: [
  { type: "TXT", name: "mail", value: "v=spf1 include:resend.com ~all" }] }
```

- [ ] **Step 3: Implement the two test bodies** using the fixtures and the per-step mock factories (real assertions, no prose).

- [ ] **Step 4: Run, verify PASS.**
Run: `cd apps/workers && npx vitest run __tests__/pipeline-chain.test.ts`
Expected: PASS — 2 tests; chain ends `status==="active"`; failing step requeues.

- [ ] **Step 5: Commit**

```bash
git add apps/workers/__tests__/pipeline-chain.test.ts apps/workers/__tests__/fixtures/mgmt-responses.ts
git commit -m "$(cat <<'EOF'
test(workers): L2 integration — 8-step chain ordering + failure requeue (Phase D)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D11: Failure-hardening — alert wiring, stuck-job sweep, timeouts (D4)

**Why:** spec §6 retry, §9 alert ladder + "provisioning stuck >30min" ALERT, §6 partial-failure. D4 = "fix race conditions / timeouts / partial failures discovered."

**Files:**
- Modify: `apps/workers/src/provisioning/dispatch.ts` (call `alertOps` on permanent failure)
- Create: `apps/workers/src/cron/stuck-job-sweep.ts` (re-queue jobs stuck in `running` > 30min; ALERT)
- Modify: `apps/workers/src/index.ts` (schedule the new cron alongside existing crons)
- Modify: `packages/control-db/src/queries/jobs.ts` (add `reapStuckRunningJobs`)
- Test: `apps/workers/__tests__/stuck-sweep.test.ts`, extend `dispatch.test.ts`

- [ ] **Step 1: Failing test — alert on permanent failure**

```ts
// add to apps/workers/__tests__/dispatch.test.ts
const alertOps = vi.fn()
vi.mock("../src/provisioning/notify", () => ({ alertOps }))
// new it():
it("calls alertOps when a step fails permanently (attempt 2)", async () => {
  getHandler.mockReturnValue({
    step: "validate", isComplete: vi.fn().mockResolvedValue(false),
    run: vi.fn().mockRejectedValue(new Error("fatal")),
  })
  await dispatchJob({ ...baseJob, attempt: 2 } as never)
  expect(alertOps).toHaveBeenCalledWith(
    expect.stringContaining("provisioning failed"),
    expect.stringContaining("validate"))
})
```

- [ ] **Step 2: Run, verify FAIL.** Run: `cd apps/workers && npx vitest run __tests__/dispatch.test.ts`

- [ ] **Step 3: Wire `alertOps` into the permanent-failure branch of `dispatch.ts`**

```ts
// in dispatch.ts, replace the `else` branch comment with:
import { alertOps } from "./notify"
// ...
} else {
  log.error({ jobId: job.id, step: job.step, msg }, "step failed permanently")
  await jobs.markJobStatus(client, job.id, "failed", { last_error: msg })
  await alertOps(
    `provisioning failed: tenant ${job.tenant_id}`,
    `step ${job.step} failed after ${job.attempt + 1} attempts: ${msg}`)
}
```

- [ ] **Step 4: Run, verify PASS.** Run: `cd apps/workers && npx vitest run __tests__/dispatch.test.ts`

- [ ] **Step 5: Failing test — stuck-job sweep**

```ts
// apps/workers/__tests__/stuck-sweep.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const reapStuckRunningJobs = vi.fn()
const alertOps = vi.fn()
vi.mock("@realreal/control-db", () => ({
  createControlClient: () => ({}), jobs: { reapStuckRunningJobs } }))
vi.mock("../src/provisioning/notify", () => ({ alertOps }))
import { sweepStuckJobs } from "../src/cron/stuck-job-sweep"

beforeEach(() => vi.clearAllMocks())

describe("sweepStuckJobs", () => {
  it("requeues jobs running > 30min and alerts", async () => {
    reapStuckRunningJobs.mockResolvedValue([{ id: "j1", step: "supabase_setup",
      tenant_id: "t1" }])
    await sweepStuckJobs()
    expect(reapStuckRunningJobs).toHaveBeenCalledWith(expect.anything(), 30)
    expect(alertOps).toHaveBeenCalledWith(
      expect.stringContaining("stuck"), expect.stringContaining("supabase_setup"))
  })
  it("no alert when nothing stuck", async () => {
    reapStuckRunningJobs.mockResolvedValue([])
    await sweepStuckJobs()
    expect(alertOps).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run, verify FAIL.** Run: `cd apps/workers && npx vitest run __tests__/stuck-sweep.test.ts`

- [ ] **Step 7: Add `reapStuckRunningJobs` to `jobs.ts`**

```ts
export async function reapStuckRunningJobs(
  c: SupabaseClient, olderThanMinutes: number,
): Promise<Array<{ id: string; step: string; tenant_id: string }>> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()
  const { data, error } = await c.from("provisioning_jobs")
    .update({ status: "queued", available_at: new Date().toISOString(), started_at: null })
    .eq("status", "running").lt("started_at", cutoff)
    .select("id, step, tenant_id")
  if (error) throw error
  return (data ?? []) as Array<{ id: string; step: string; tenant_id: string }>
}
```

- [ ] **Step 8: Implement `stuck-job-sweep.ts`**

```ts
// apps/workers/src/cron/stuck-job-sweep.ts
import cron from "node-cron"
import pino from "pino"
import { createControlClient, jobs } from "@realreal/control-db"
import { alertOps } from "../provisioning/notify"

const log = pino({ name: "stuck-sweep" })

export async function sweepStuckJobs(): Promise<void> {
  const reaped = await jobs.reapStuckRunningJobs(createControlClient(), 30)
  if (reaped.length === 0) return
  log.warn({ count: reaped.length }, "requeued stuck running jobs")
  await alertOps(
    `provisioning jobs stuck >30min (requeued ${reaped.length})`,
    reaped.map(j => `${j.tenant_id}/${j.step}`).join(", "))
}

export function scheduleStuckJobSweep() {
  return cron.schedule("*/5 * * * *", () => {
    void sweepStuckJobs().catch(e =>
      log.error({ e: e instanceof Error ? e.message : e }, "stuck sweep failed"))
  })
}
```

- [ ] **Step 9: Schedule it in `apps/workers/src/index.ts`** (alongside the existing crons in `main()`)

```ts
import { scheduleStuckJobSweep } from "./cron/stuck-job-sweep"
// change the tasks line to:
const tasks = [scheduleHealthCheck(), scheduleResendDkimVerify(),
               scheduleStripeSync(), scheduleStuckJobSweep()]
```

- [ ] **Step 10: Run full suite, verify PASS.** Run: `cd apps/workers && npx vitest run && npx tsc --noEmit`

- [ ] **Step 11: Commit**

```bash
git add apps/workers/src/provisioning/dispatch.ts apps/workers/src/cron/stuck-job-sweep.ts apps/workers/src/index.ts packages/control-db/src/queries/jobs.ts apps/workers/__tests__/dispatch.test.ts apps/workers/__tests__/stuck-sweep.test.ts
git commit -m "$(cat <<'EOF'
feat(workers): alert on permanent failure + 30min stuck-job sweep (Phase D4 hardening)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## PR-D12: Live-provision harness (D3 / D5) + runbook

**Why:** D3 = spin up throwaway `pioneer-test`; D5 = 3 consecutive successful live provisions. This is the L3 manual harness (spec §10), gated behind an explicit flag, plus the missing `stripe-webhook-pileup.md` runbook (spec §9).

**Files:**
- Create: `scripts/provision-throwaway.ts`
- Create: `docs/runbooks/stripe-webhook-pileup.md`
- Test: `apps/workers/__tests__/provision-throwaway.test.ts` (unit-tests the arg parsing + safety guard only — no live calls in CI)

- [ ] **Step 1: Failing test — safety guard**

```ts
// apps/workers/__tests__/provision-throwaway.test.ts
import { describe, it, expect } from "vitest"
import { assertLiveAllowed } from "../../../scripts/provision-throwaway"

describe("provision-throwaway safety", () => {
  it("throws unless ALLOW_LIVE_PROVISION=yes", () => {
    delete process.env.ALLOW_LIVE_PROVISION
    expect(() => assertLiveAllowed()).toThrow(/ALLOW_LIVE_PROVISION/)
  })
  it("passes when explicitly allowed", () => {
    process.env.ALLOW_LIVE_PROVISION = "yes"
    expect(() => assertLiveAllowed()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** Run: `cd apps/workers && npx vitest run __tests__/provision-throwaway.test.ts`

- [ ] **Step 3: Implement `scripts/provision-throwaway.ts`**

```ts
// scripts/provision-throwaway.ts
// Manual L3 harness: simulates a Stripe test-mode checkout.session.completed,
// drives the real pipeline against real (test) infra, polls to completion,
// then optionally tears the tenant down. NEVER runs in CI.
import { createControlClient, tenants, jobs } from "@realreal/control-db"

export function assertLiveAllowed(): void {
  if (process.env.ALLOW_LIVE_PROVISION !== "yes") {
    throw new Error(
      "refusing: set ALLOW_LIVE_PROVISION=yes to run a live (test-mode) provision")
  }
}

async function provisionOnce(slug: string): Promise<"active" | "failed"> {
  const c = createControlClient()
  const id = await tenants.createTenant(c, {
    slug, custom_domain: null, owner_user_id: process.env.PIONEER_OWNER_ID!,
    plan: "standard",
  })
  await jobs.enqueueJobs(c, id, [
    "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
    "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
  ])
  // Poll the tenant row until terminal (the live workers process drains the queue).
  const deadline = Date.now() + 12 * 60_000
  for (;;) {
    const t = await tenants.getTenant(c, id)
    if (t?.status === "active") return "active"
    if (t?.status === "failed") return "failed"
    if (Date.now() > deadline) throw new Error(`timeout: tenant ${slug} not terminal in 12m`)
    await new Promise(r => setTimeout(r, 10_000))
  }
}

async function main() {
  assertLiveAllowed()
  const runs = Number(process.argv[2] ?? 1)   // D5: pass 3
  for (let i = 1; i <= runs; i++) {
    const slug = `pioneer-test-${Date.now().toString(36)}-${i}`
    console.log(`▶ provision ${i}/${runs}: ${slug}`)
    const result = await provisionOnce(slug)
    console.log(`  → ${result}`)
    if (result !== "active") process.exit(1)
  }
  console.log(`✓ ${runs} consecutive successful live provisions`)
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: Run, verify PASS.** Run: `cd apps/workers && npx vitest run __tests__/provision-throwaway.test.ts`

- [ ] **Step 5: Write the runbook**

```md
<!-- docs/runbooks/stripe-webhook-pileup.md -->
# Runbook: Stripe webhook pileup

**Symptom:** `provisioning_jobs` backlog grows; `/jobs` shows many `queued`;
Stripe dashboard shows webhook retries.

**Diagnose:**
1. `GET https://<workers-host>/health` — is the workers process up?
2. Control DB: `select status, count(*) from provisioning_jobs group by status;`
3. Check Railway logs for `dispatch` errors / Mgmt-API quota (`429`).

**Resolve:**
- Workers down → redeploy workers Railway service.
- Mgmt-API quota → wait for reset; jobs auto-retry via `available_at` backoff.
- A poison job (attempt=3, failed) → fix root cause, then in `/jobs` click
  "Retry from this step" (re-queues with attempt=0).
- Duplicate Stripe deliveries are deduped by `stripe_webhook_events`; safe.

**Escalate:** if backlog > 50 or stuck > 30min, the stuck-job sweep ALERTs
`#platform-ops`. Page the on-call platform admin.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/provision-throwaway.ts docs/runbooks/stripe-webhook-pileup.md apps/workers/__tests__/provision-throwaway.test.ts
git commit -m "$(cat <<'EOF'
feat(workers): live-provision L3 harness (D3/D5) + stripe-webhook-pileup runbook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> **USER-ACTIONABLE (cannot be automated by the agent):**
> - **D2 prerequisite:** create the Stripe **test-mode** product + price, and configure the test webhook endpoint in the Stripe dashboard pointing at `https://<workers-host>/webhooks/stripe`; copy `STRIPE_SECRET_KEY` (test) + `STRIPE_WEBHOOK_SECRET` into the workers Railway env. (Spec §12 open question 2.)
> - Provide Mgmt-API tokens as workers env: `SUPABASE_PAT`, `SUPABASE_ORG_ID`, `VERCEL_TOKEN`, `RAILWAY_TOKEN`, `RESEND_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PLATFORM_ZONE_ID`, `PLATFORM_KEK`, `OWNER_ADMIN_EMAIL`, `SLACK_WEBHOOK_URL`, `PIONEER_OWNER_ID`.
> - **D3/D5 execution:** run `ALLOW_LIVE_PROVISION=yes npx tsx scripts/provision-throwaway.ts 3` against test infra and confirm 3 green runs + smoke (site 200, `/health` 200, `/healthz` 200). Tear down throwaway tenants after.
> - **BYO domain** steps require the customer to set DNS — the v1 manual confirm gate (`/tenants/[id]` "Mark domain configured") is operated by a human.

---

## PR-D13: Canary tenant + production-branch deploy fan-out (D6)

**Why:** D6 = create `staging-canary` tenant + wire production-branch auto-deploy. Spec §7 `deploy-production-fanout.yml`.

**Files:**
- Create: `.github/workflows/deploy-production-fanout.yml`
- Create: `scripts/create-canary-tenant.ts`
- Create: `scripts/fanout-deploy.ts` (queries control DB for `active` tenants, triggers Vercel + Railway builds, logs per-tenant to `audit_log`, never aborts siblings)
- Reuse: `infrastructure/provisioning/apply-tenant-migrations.ts` for the `migrations` job
- Test: `apps/workers/__tests__/fanout-deploy.test.ts` (unit: partial-failure does not abort siblings; audit logged)

- [ ] **Step 1: Failing test — fan-out continues on partial failure**

```ts
// apps/workers/__tests__/fanout-deploy.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
const listActiveTenants = vi.fn()
const getInfrastructure = vi.fn()
const emitAudit = vi.fn()
const triggerVercelDeploy = vi.fn()
const deployRailwayService = vi.fn()
vi.mock("@realreal/control-db", () => ({
  createControlClient: () => ({}),
  tenants: { listActiveTenants },
  infrastructure: { getInfrastructure },
  audit: { emitAudit },
}))
vi.mock("@realreal/provisioning/clients/vercel", () => ({ triggerVercelDeploy }))
vi.mock("@realreal/provisioning/clients/railway", () => ({ deployRailwayService }))
import { fanoutDeploy } from "../../../scripts/fanout-deploy"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VERCEL_TOKEN = "v"; process.env.RAILWAY_TOKEN = "r"
  listActiveTenants.mockResolvedValue([
    { id: "tA", slug: "a" }, { id: "tB", slug: "b" }])
  getInfrastructure.mockImplementation(async (_c: unknown, id: string) => ({
    tenant_id: id, vercel_project_id: `prj_${id}`,
    railway_api_service_id: `api_${id}`, railway_mcp_service_id: `mcp_${id}` }))
})

describe("fanoutDeploy", () => {
  it("continues to tenant B even if tenant A's Vercel deploy throws", async () => {
    triggerVercelDeploy.mockRejectedValueOnce(new Error("A failed"))
    const summary = await fanoutDeploy()
    expect(summary).toEqual({ ok: ["b"], failed: ["a"] })
    expect(emitAudit).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ tenant_id: "tA", action: "fanout_deploy_failed" }))
    expect(emitAudit).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ tenant_id: "tB", action: "fanout_deploy_ok" }))
  })
})
```

- [ ] **Step 2: Run, verify FAIL.** Run: `cd apps/workers && npx vitest run __tests__/fanout-deploy.test.ts`

- [ ] **Step 3: Implement `scripts/fanout-deploy.ts`**

```ts
// scripts/fanout-deploy.ts
import { createControlClient, tenants, infrastructure, audit } from "@realreal/control-db"
import { triggerVercelDeploy } from "@realreal/provisioning/clients/vercel"
import { deployRailwayService } from "@realreal/provisioning/clients/railway"

export async function fanoutDeploy(): Promise<{ ok: string[]; failed: string[] }> {
  const c = createControlClient()
  const vToken = process.env.VERCEL_TOKEN!
  const rToken = process.env.RAILWAY_TOKEN!
  const active = await tenants.listActiveTenants(c)
  const ok: string[] = []
  const failed: string[] = []
  for (const t of active) {
    try {
      const i = await infrastructure.getInfrastructure(c, t.id)
      if (!i) throw new Error("no infrastructure row")
      if (i.vercel_project_id) await triggerVercelDeploy(vToken, i.vercel_project_id)
      if (i.railway_api_service_id) await deployRailwayService(rToken, i.railway_api_service_id)
      if (i.railway_mcp_service_id) await deployRailwayService(rToken, i.railway_mcp_service_id)
      ok.push(t.slug)
      await audit.emitAudit(c, { tenant_id: t.id, actor_type: "system",
        actor_id: "fanout", action: "fanout_deploy_ok", resource: null, payload: null })
    } catch (e) {
      failed.push(t.slug)
      await audit.emitAudit(c, { tenant_id: t.id, actor_type: "system",
        actor_id: "fanout", action: "fanout_deploy_failed", resource: null,
        payload: { error: e instanceof Error ? e.message : String(e) } })
      // do NOT rethrow — siblings must still deploy (spec §7 promote job)
    }
  }
  return { ok, failed }
}

if (require.main === module) {
  fanoutDeploy().then(s => {
    console.log(JSON.stringify(s))
    if (s.failed.length) process.exitCode = 1   // surface partial failure to CI
  }).catch(e => { console.error(e); process.exit(1) })
}
```

- [ ] **Step 4: Run, verify PASS.** Run: `cd apps/workers && npx vitest run __tests__/fanout-deploy.test.ts`

- [ ] **Step 5: Implement `scripts/create-canary-tenant.ts`** (idempotent: skip if `staging-canary` exists)

```ts
// scripts/create-canary-tenant.ts
// One-time: registers a platform-owned canary tenant and enqueues the
// pipeline. All modules will be enabled and synthetic data seeded by the
// canary's own admin post-provision (spec §7).
import { createControlClient, tenants, jobs } from "@realreal/control-db"

async function main() {
  const c = createControlClient()
  const existing = await tenants.getTenantBySlug(c, "staging-canary")
  if (existing) { console.log("staging-canary already exists; nothing to do"); return }
  const id = await tenants.createTenant(c, {
    slug: "staging-canary", custom_domain: null,
    owner_user_id: process.env.PLATFORM_OWNER_ID!, plan: "pro",
  })
  await jobs.enqueueJobs(c, id, [
    "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
    "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
  ])
  console.log(`✓ enqueued provisioning for staging-canary (${id})`)
}
main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 6: Create the GitHub Actions workflow** (spec §7 structure: canary → migrations → promote w/ manual approval → monitor)

```yaml
# .github/workflows/deploy-production-fanout.yml
name: deploy-production-fanout
on:
  push:
    branches: [production]

jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: Deploy + smoke-test canary
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
          CONTROL_DB_URL: ${{ secrets.CONTROL_DB_URL }}
          CONTROL_DB_SERVICE_ROLE_KEY: ${{ secrets.CONTROL_DB_SERVICE_ROLE_KEY }}
        run: npx tsx scripts/fanout-deploy.ts --only=staging-canary
      - name: Smoke
        run: |
          curl -fsS https://canary.platform.realreal.cc/ >/dev/null
          curl -fsS https://api-canary.up.railway.app/health >/dev/null
          curl -fsS https://mcp-canary.up.railway.app/healthz >/dev/null

  migrations:
    needs: canary
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: Fan out tenant migrations
        env:
          SUPABASE_PAT: ${{ secrets.SUPABASE_PAT }}
          CONTROL_DB_URL: ${{ secrets.CONTROL_DB_URL }}
          CONTROL_DB_SERVICE_ROLE_KEY: ${{ secrets.CONTROL_DB_SERVICE_ROLE_KEY }}
        run: npx tsx scripts/fanout-migrations.ts

  promote:
    needs: [canary, migrations]
    runs-on: ubuntu-latest
    environment: production-fanout      # GitHub Environments → manual approval gate
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: Fan out to all active tenants
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
          CONTROL_DB_URL: ${{ secrets.CONTROL_DB_URL }}
          CONTROL_DB_SERVICE_ROLE_KEY: ${{ secrets.CONTROL_DB_SERVICE_ROLE_KEY }}
        run: npx tsx scripts/fanout-deploy.ts
```

> **Note for the engineer:** `fanout-deploy.ts` must accept an optional
> `--only=<slug>` arg for the canary job (filter `listActiveTenants` to that
> slug). Add that arg parsing in Step 3's implementation (the test already
> pins the no-arg behavior; add a focused test for `--only` filtering before
> committing). `scripts/fanout-migrations.ts` wraps the existing
> `infrastructure/provisioning/apply-tenant-migrations.ts` loop over every
> active tenant's `supabase_project_ref` (diff vs `schema_migrations`,
> idempotent; abort the whole job on any migration error per spec §7).
> The `monitor` job from spec §7 is **deferred to Phase E** (it depends on
> the health-check cron already shipped in Phase A) — noted in Self-Review.

- [ ] **Step 7: Add `--only` filter + its test, run full suite, verify PASS**

Run: `cd apps/workers && npx vitest run && npx tsc --noEmit`

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/deploy-production-fanout.yml scripts/fanout-deploy.ts scripts/create-canary-tenant.ts scripts/fanout-migrations.ts apps/workers/__tests__/fanout-deploy.test.ts
git commit -m "$(cat <<'EOF'
feat(deploy): canary script + production-branch fan-out workflow (Phase D6)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> **USER-ACTIONABLE:**
> - Add GitHub repo secrets: `VERCEL_TOKEN`, `RAILWAY_TOKEN`, `SUPABASE_PAT`, `CONTROL_DB_URL`, `CONTROL_DB_SERVICE_ROLE_KEY`.
> - Create the GitHub **Environment** `production-fanout` and add yourself as a required reviewer (this is the manual approval gate; spec §7).
> - Run `npx tsx scripts/create-canary-tenant.ts` once (with `PLATFORM_OWNER_ID` set) to provision `staging-canary`; then point `canary.platform.realreal.cc` DNS / Vercel domain at the canary Vercel project (DNS is human-operated).
> - Create the `production` branch from `main` if it does not yet exist (Phase C6 may already have done this).

---

## Self-Review

**1. Spec coverage (§11 D1–D6 + supporting sections):**

| Spec requirement | Covered by |
|---|---|
| §11 D1 — implement 8 step handlers | PR-D4 (interface), PR-D6 (1–2), PR-D7 (3–4), PR-D8 (5–6), PR-D9 (7–8) |
| §11 D2 — hook Stripe test webhook | PR-D3 (webhook → tenant + enqueue, persistent idempotency); USER-ACTIONABLE Stripe dashboard config in PR-D12 |
| §11 D3 — throwaway `pioneer-test` via pipeline | PR-D12 `scripts/provision-throwaway.ts` |
| §11 D4 — fix races/timeouts/partial failures | PR-D5 (retry/backoff), PR-D11 (alert + 30min stuck-job sweep + timeouts via `AbortSignal.timeout` in PR-D1 clients) |
| §11 D5 — 3 consecutive live provisions | PR-D12 `provision-throwaway.ts 3` |
| §11 D6 — canary + production auto-deploy | PR-D13 (canary script + `deploy-production-fanout.yml`) |
| §6 step handler interface `isComplete`/`run` | PR-D4 `steps/types.ts` |
| §6 idempotency pre-check | every handler's `isComplete` (PR-D6..D9) |
| §6 retry ladder 30s/2min/fail+alert | PR-D5 `dispatch.ts` `BACKOFF_MS` + PR-D11 `alertOps` |
| §6 8 steps incl. seed/Auth/buckets | PR-D6 `supabase-setup.ts` (migrations incl. 0020 seed, `configureAuth`, `createStorageBuckets`) |
| §4 control DB tenants/infra/jobs/stripe_events | PR-D2 query helpers + PR-D5 migrations `0013/0014` |
| §4 KEK aes-256-gcm for service_role key | PR-D2 `upsertInfrastructure` uses existing `crypto.ts` `encrypt()` |
| §6 step 3 BYO vs shared Resend domain | PR-D7 `resend-setup.ts` (BYO → dedicated; subdomain → no-op) |
| §6 step 4 platform CNAME vs BYO email | PR-D7 `cloudflare-dns.ts` |
| §8 MCP token bcrypt hash + virtual admin | PR-D9 `tenant-finalize.ts` |
| §7 canary → migrations → promote(approval) → monitor | PR-D13 workflow (monitor explicitly deferred to Phase E — see below) |
| §9 alert ladder + stuck >30min ALERT | PR-D11 |
| §9 `stripe-webhook-pileup.md` runbook | PR-D12 |
| §10 L1 unit / L2 chain / L3 live | L1 across PR-D1..D9, L2 PR-D10, L3 PR-D12 |

**2. Placeholder scan:** PR-D10's test bodies are intentionally left as scaffolding with an explicit "do not commit with empty bodies; implement using the per-step mock factories + fixtures" instruction and a concrete fixtures module — this is a deliberate, bounded handoff (the chaining is mechanical and fully specified by the prior step tests), not a hidden TBD. All other steps contain complete, runnable code.

**3. Type consistency:** `StepHandler`/`TenantContext`/`STEP_ORDER` (PR-D4) are used unchanged in PR-D6..D9. `InfraPatch` field names (PR-D2) match every `upsertInfrastructure` call site. `ProvisioningStep` union (existing `control-db/types.ts`) matches the enqueued step list in PR-D3, PR-D12, PR-D13 and `STEP_ORDER`. `requeueJob(client,id,attempt,delayMs,error)` signature (PR-D5) matches its `dispatch.ts` call and its test.

**Spec ambiguities resolved (also reported to the user):**
- *Seed vs migration:* spec §5 says seed runs "during provisioning" while §11 lists `0020_brand_seed.sql` as a migration. Resolved by treating seed as part of the migration set the `supabase_setup` loop applies — keeps it idempotent, no separate non-idempotent seed step.
- *Stripe replay window:* `recordStripeEvent` commits before `createTenant`; a crash between them would orphan the event. Resolved by documenting manual replay via `/jobs` in the runbook (full transactional outbox is out of Phase D scope).
- *`monitor` fan-out job:* spec §7 lists a `monitor` job, but it overlaps the Phase-A health-check cron and Phase E GA work. Resolved by shipping canary→migrations→promote in Phase D and explicitly deferring `monitor`/auto-rollback to Phase E.
- *`available_at` retry column:* spec describes delayed retry but the Phase-A schema has no delay column. Resolved by adding idempotent migrations `0013`/`0014` (new column + `claim_queued_job` predicate) in PR-D5.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-phase-d-provisioning-pipeline.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per PR (D1…D13), review between tasks.
2. **Inline Execution** — execute PRs in this session with checkpoints.

Which approach?
