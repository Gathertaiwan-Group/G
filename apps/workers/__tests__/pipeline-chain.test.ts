import { createHash } from "node:crypto"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { STEP_ORDER } from "../src/provisioning/steps/types"
import * as fx from "./fixtures/mgmt-responses"

// ── L2 integration test (PR-D10) ────────────────────────────────────────────
// Drives the REAL dispatcher (`dispatchJob`) + REAL `loadTenantContext` + REAL
// step registry + REAL 8 step handlers over an in-memory fake control DB, with
// every Management-API client mocked from recorded fixtures. This exercises the
// actual chain orchestration, ordering, and `provisioning_jobs` /
// `tenant_infrastructure` / `tenants.status` state machine — no network, no
// real Supabase/Vercel/Railway/Resend/Cloudflare.
//
// ADAPTATIONS vs the PR-D10 plan snippet (the plan predates the merged step
// files; intent preserved, signatures adapted — each noted at its site):
//
//  A1. `makeFakeControl()` in the plan only declares `{ state }`. The merged
//      `dispatch.ts`/`context.ts`/handlers actually call a specific set of
//      `@realreal/control-db` functions (createControlClient, jobs.*,
//      tenants.*, infrastructure.*, loadKek). The fake implements exactly
//      those against the shared `state`, so the plan's "in-memory control DB:
//      tenants + tenant_infrastructure + provisioning_jobs" intent is met with
//      the real call surface.
//
//  A2. Plan fixtures used `{ id }`-shaped JSON. Merged clients return adapted
//      shapes (createSupabaseProject -> {ref,url}; fetchProjectApiKeys ->
//      {anon,serviceRole}; createRailway* -> id string). fixtures/
//      mgmt-responses.ts keeps the recorded values in the merged shapes.
//
//  A3. The plan asserts the chain ends `status === "active"` with supabase/
//      vercel/railway ids + mcp hash in tenant_infrastructure, and that
//      domain_finalize (which hard-requires `railway_api_url` /
//      `railway_mcp_url`) runs. railway-setup.ts now creates a Railway public
//      domain per service (getRailwayEnvironmentId + createRailwayServiceDomain)
//      and persists `railway_api_url` / `railway_mcp_url` in the SAME upsert as
//      the service ids, so the real chain reaches domain_finalize ->
//      tenant_finalize with NO harness intervention. The previous
//      `RAILWAY_URL_GAP` seam and its known-bug guard test have been removed
//      now that the production gap is fixed; the chain is driven end-to-end
//      using only the real step handlers.

const fakeControl = vi.hoisted(() => {
  type Job = {
    id: string; tenant_id: string; step: string; attempt: number
    status: string; last_error: string | null
  }
  const state = {
    tenant: {
      id: "t1", slug: "pioneer-test", custom_domain: null as string | null,
      status: "pending_payment", owner_user_id: "u1", plan: "standard",
    } as Record<string, unknown>,
    infra: null as Record<string, unknown> | null,
    jobs: {} as Record<string, Job>,
    // ordered log of every (step,status) transition the dispatcher drove
    transitions: [] as Array<{ step: string; status: string }>,
  }
  return { state }
})
const { state } = fakeControl

// Per-step Mgmt-API mocks (same module boundaries as the PR-D6..D9 step tests).
const m = vi.hoisted(() => ({
  // supabase-mgmt
  createSupabaseProject: vi.fn(),
  pollProjectHealthy: vi.fn(),
  fetchProjectApiKeys: vi.fn(),
  runTenantSql: vi.fn(),
  configureAuth: vi.fn(),
  createStorageBuckets: vi.fn(),
  // vercel
  createVercelProject: vi.fn(),
  setVercelEnv: vi.fn(),
  triggerVercelDeploy: vi.fn(),
  pollVercelReady: vi.fn(),
  addVercelDomain: vi.fn(),
  // railway
  createRailwayProject: vi.fn(),
  createRailwayService: vi.fn(),
  setRailwayVars: vi.fn(),
  deployRailwayService: vi.fn(),
  pollRailwayHealthz: vi.fn(),
  getRailwayEnvironmentId: vi.fn(),
  createRailwayServiceDomain: vi.fn(),
  // resend / cloudflare
  addResendDomain: vi.fn(),
  upsertCnameRecord: vi.fn(),
  // notify
  sendWelcomeEmail: vi.fn(),
}))

vi.mock("@realreal/control-db", () => ({
  createControlClient: () => ({}),
  loadKek: () => Buffer.alloc(32),
  jobs: {
    markJobStatus: vi.fn(async (_c: unknown, id: string, status: string,
      patch: { last_error?: string | null } = {}) => {
      const j = state.jobs[id]
      j.status = status
      if (status === "success") j.last_error = null
      if (patch.last_error !== undefined) j.last_error = patch.last_error
      state.transitions.push({ step: j.step, status })
    }),
    requeueJob: vi.fn(async (_c: unknown, id: string, nextAttempt: number,
      _delayMs: number, lastError: string) => {
      const j = state.jobs[id]
      j.status = "queued"
      j.attempt = nextAttempt
      j.last_error = lastError
      state.transitions.push({ step: j.step, status: "queued" })
    }),
  },
  tenants: {
    getTenant: vi.fn(async () => ({ ...state.tenant })),
    updateTenantStatus: vi.fn(async (_c: unknown, _id: string, status: string) => {
      state.tenant.status = status
    }),
  },
  infrastructure: {
    getInfrastructure: vi.fn(async () => (state.infra ? { ...state.infra } : null)),
    upsertInfrastructure: vi.fn(async (_c: unknown, _id: string,
      patch: Record<string, unknown>) => {
      state.infra = { ...(state.infra ?? {}), ...patch }
    }),
    // Faithful to the real packages/control-db helper and apps/mcp's
    // sha256hex: generate a token + its sha256 hex hash together. Required
    // now that tenant_finalize uses the shared helper instead of bcrypt.
    hashMcpToken: vi.fn(() => {
      const token = "0".repeat(64)
      const hash = createHash("sha256").update(token, "utf8").digest("hex")
      return { token, hash }
    }),
  },
}))
vi.mock("@realreal/provisioning/clients/supabase-mgmt", () => ({
  createSupabaseProject: m.createSupabaseProject,
  pollProjectHealthy: m.pollProjectHealthy,
  fetchProjectApiKeys: m.fetchProjectApiKeys,
  runTenantSql: m.runTenantSql,
  configureAuth: m.configureAuth,
  createStorageBuckets: m.createStorageBuckets,
}))
vi.mock("@realreal/provisioning/clients/vercel", () => ({
  createVercelProject: m.createVercelProject,
  setVercelEnv: m.setVercelEnv,
  triggerVercelDeploy: m.triggerVercelDeploy,
  pollVercelReady: m.pollVercelReady,
  addVercelDomain: m.addVercelDomain,
}))
vi.mock("@realreal/provisioning/clients/railway", () => ({
  createRailwayProject: m.createRailwayProject,
  createRailwayService: m.createRailwayService,
  setRailwayVars: m.setRailwayVars,
  deployRailwayService: m.deployRailwayService,
  pollRailwayHealthz: m.pollRailwayHealthz,
  getRailwayEnvironmentId: m.getRailwayEnvironmentId,
  createRailwayServiceDomain: m.createRailwayServiceDomain,
}))
vi.mock("@realreal/provisioning/clients/resend", () => ({
  addResendDomain: m.addResendDomain,
}))
vi.mock("@realreal/provisioning/clients/cloudflare", () => ({
  upsertCnameRecord: m.upsertCnameRecord,
}))
vi.mock("../src/provisioning/notify", () => ({
  sendWelcomeEmail: m.sendWelcomeEmail,
  alertOps: vi.fn(),
}))

// Import AFTER vi.mock so the real dispatcher/handlers bind to the mocks.
const { dispatchJob } = await import("../src/provisioning/dispatch")
// Self-registers all 8 handlers into the real registry at module load.
await import("../src/provisioning/steps/registry-all")

// Seed every Mgmt mock with recorded fixtures for the happy path.
function primeHappyPath() {
  m.createSupabaseProject.mockResolvedValue({
    ref: fx.SUPABASE_PROJECT.ref, url: fx.SUPABASE_PROJECT.url,
  })
  m.pollProjectHealthy.mockResolvedValue(undefined)
  m.fetchProjectApiKeys.mockResolvedValue({
    anon: fx.SUPABASE_KEYS.anon, serviceRole: fx.SUPABASE_KEYS.serviceRole,
  })
  m.runTenantSql.mockResolvedValue([])
  m.configureAuth.mockResolvedValue(undefined)
  m.createStorageBuckets.mockResolvedValue(undefined)
  m.createVercelProject.mockResolvedValue(fx.VERCEL_PROJECT.id)
  m.setVercelEnv.mockResolvedValue(undefined)
  m.triggerVercelDeploy.mockResolvedValue(fx.VERCEL_DEPLOY.id)
  m.pollVercelReady.mockResolvedValue(fx.VERCEL_DEPLOY.url)
  m.addVercelDomain.mockResolvedValue(undefined)
  m.createRailwayProject.mockResolvedValue(fx.RAILWAY_PROJECT.id)
  m.getRailwayEnvironmentId.mockResolvedValue(fx.RAILWAY_ENVIRONMENT.id)
  m.createRailwayService
    .mockResolvedValueOnce(fx.RAILWAY_API_SVC.id)
    .mockResolvedValueOnce(fx.RAILWAY_MCP_SVC.id)
  m.createRailwayServiceDomain
    .mockResolvedValueOnce(fx.RAILWAY_API_SVC.domain)
    .mockResolvedValueOnce(fx.RAILWAY_MCP_SVC.domain)
  m.setRailwayVars.mockResolvedValue(undefined)
  m.deployRailwayService.mockResolvedValue(undefined)
  m.pollRailwayHealthz.mockResolvedValue(undefined)
  m.addResendDomain.mockResolvedValue({ id: fx.RESEND_DOMAIN.id })
  m.upsertCnameRecord.mockResolvedValue(undefined)
  m.sendWelcomeEmail.mockResolvedValue(undefined)
}

// One queued job per step, dispatched in STEP_ORDER, mirroring the poll-based
// runner (which claims one job at a time and reloads context each iteration).
function makeJob(step: string): { id: string; tenant_id: string; step: string; attempt: number; status: string; last_error: null } {
  const id = `job_${step}`
  const job = { id, tenant_id: "t1", step, attempt: 0, status: "queued" as string, last_error: null }
  state.jobs[id] = job
  return job
}

beforeEach(() => {
  vi.clearAllMocks()
  state.tenant = {
    id: "t1", slug: "pioneer-test", custom_domain: null,
    status: "pending_payment", owner_user_id: "u1", plan: "standard",
  }
  state.infra = null
  state.jobs = {}
  state.transitions = []
  process.env.SUPABASE_PAT = "pat"
  process.env.SUPABASE_ORG_ID = "org"
  process.env.PLATFORM_KEK = "0123456789abcdef0123456789abcdef"
  process.env.VERCEL_TOKEN = "vtok"
  process.env.RAILWAY_TOKEN = "rtok"
  process.env.INTERNAL_API_SECRET = "isecret"
  process.env.RESEND_API_KEY = "rsk"
  process.env.CLOUDFLARE_API_TOKEN = "cf"
  process.env.CLOUDFLARE_PLATFORM_ZONE_ID = "zone"
  process.env.OWNER_ADMIN_EMAIL = "owner@example.com"
  primeHappyPath()
})

describe("8-step pipeline chain (L2)", () => {
  it("STEP_ORDER is the canonical 8-step provisioning sequence", () => {
    expect(STEP_ORDER).toEqual([
      "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
      "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
    ])
  })

  it("runs all steps in order, transitioning each job queued→running→success and ending tenant active", async () => {
    for (const step of STEP_ORDER) {
      const job = makeJob(step)
      // claim (queued→running), exactly as claimQueuedJob would before dispatch
      job.status = "running"
      state.transitions.push({ step, status: "running" })
      await dispatchJob(job as never)
    }

    // ── Ordering: dispatcher drove the steps in exactly STEP_ORDER ──────────
    const succeededInOrder = state.transitions
      .filter(t => t.status === "success").map(t => t.step)
    expect(succeededInOrder).toEqual(STEP_ORDER)

    // ── State machine: every job starts queued, is claimed (→running), then
    //    the dispatcher marks it success. The transition log records the two
    //    state CHANGES (running, success); "queued" is the initial state. ────
    for (const step of STEP_ORDER) {
      const seq = state.transitions.filter(t => t.step === step).map(t => t.status)
      expect(seq).toEqual(["running", "success"])
      expect(state.jobs[`job_${step}`].status).toBe("success")
    }
    // no job ever entered "failed" or got requeued on the happy path
    expect(state.transitions.some(t => t.status === "failed")).toBe(false)

    // ── Tenant lifecycle: pending_payment → provisioning → active ───────────
    expect(state.tenant.status).toBe("active")

    // ── Infra accumulated across the chain (plan's required assertions) ─────
    expect(state.infra).toMatchObject({
      supabase_project_ref: fx.SUPABASE_PROJECT.ref,
      supabase_url: fx.SUPABASE_PROJECT.url,
      vercel_project_id: fx.VERCEL_PROJECT.id,
      railway_project_id: fx.RAILWAY_PROJECT.id,
      railway_api_service_id: fx.RAILWAY_API_SVC.id,
      railway_mcp_service_id: fx.RAILWAY_MCP_SVC.id,
      // railway_setup itself now creates+persists the public URLs (no harness
      // seam) so domain_finalize's ordering guard passes and the chain reaches
      // `active`.
      railway_api_url: fx.RAILWAY_API_SVC.url,
      railway_mcp_url: fx.RAILWAY_MCP_SVC.url,
      mcp_token_hash: expect.any(String),
    })

    // ── Cross-step data flow actually happened (not just status flips) ──────
    // vercel_setup consumed supabase_setup's persisted url/anon key
    expect(m.setVercelEnv).toHaveBeenCalledWith("vtok", fx.VERCEL_PROJECT.id,
      expect.objectContaining({
        NEXT_PUBLIC_SUPABASE_URL: fx.SUPABASE_PROJECT.url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: fx.SUPABASE_KEYS.anon,
      }))
    // tenant_finalize created the virtual MCP admin + sent welcome email
    expect(m.runTenantSql).toHaveBeenCalledWith("pat", fx.SUPABASE_PROJECT.ref,
      expect.stringContaining("mcp@pioneer-test.local"), expect.any(String))
    expect(m.sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@example.com", slug: "pioneer-test" }))
  })

  it("a failing mid-chain step requeues (attempt+1) and does not advance the chain", async () => {
    // Drive validate → supabase_setup → resend_setup → cloudflare_dns →
    // vercel_setup successfully.
    for (const step of ["validate", "supabase_setup", "resend_setup",
      "cloudflare_dns", "vercel_setup"]) {
      const job = makeJob(step)
      job.status = "running"
      state.transitions.push({ step, status: "running" })
      await dispatchJob(job as never)
    }
    expect(state.tenant.status).toBe("provisioning")

    // railway_setup fails its first attempt (transient Mgmt-API 500).
    m.createRailwayService.mockReset()
    m.createRailwayService.mockRejectedValueOnce(new Error("railway 500: capacity"))
    const railwayJob = makeJob("railway_setup")
    railwayJob.status = "running"
    state.transitions.push({ step: "railway_setup", status: "running" })
    await dispatchJob(railwayJob as never)

    // Dispatcher requeued with attempt+1 and the documented 30s backoff path.
    expect(railwayJob.status).toBe("queued")
    expect(railwayJob.attempt).toBe(1)
    expect(railwayJob.last_error).toContain("railway 500")
    // railway_setup never reached "success": it was claimed (running) then
    // requeued (queued) by the dispatcher's retry path — no infra by it.
    expect(state.transitions.filter(t => t.step === "railway_setup")
      .map(t => t.status)).toEqual(["running", "queued"])
    expect(state.infra?.railway_project_id).toBeUndefined()

    // CHAIN HALT: later steps must NOT have run while railway is unresolved.
    expect(state.jobs.job_domain_finalize).toBeUndefined()
    expect(state.jobs.job_tenant_finalize).toBeUndefined()
    expect(m.addVercelDomain).not.toHaveBeenCalled()
    expect(m.sendWelcomeEmail).not.toHaveBeenCalled()
    expect(state.tenant.status).not.toBe("active")
    expect(state.tenant.status).toBe("provisioning")

    // RETRY SUCCEEDS: re-claim the requeued job; railway now succeeds, chain
    // resumes and reaches `active`.
    m.createRailwayService.mockReset()
    m.createRailwayService
      .mockResolvedValueOnce(fx.RAILWAY_API_SVC.id)
      .mockResolvedValueOnce(fx.RAILWAY_MCP_SVC.id)
    railwayJob.status = "running"
    state.transitions.push({ step: "railway_setup", status: "running" })
    await dispatchJob(railwayJob as never)
    expect(railwayJob.status).toBe("success")
    // railway_setup itself persisted the public URLs on the successful retry
    // (no harness seam) so domain_finalize can now proceed.
    expect(state.infra?.railway_api_url).toBe(fx.RAILWAY_API_SVC.url)
    expect(state.infra?.railway_mcp_url).toBe(fx.RAILWAY_MCP_SVC.url)

    for (const step of ["domain_finalize", "tenant_finalize"]) {
      const job = makeJob(step)
      job.status = "running"
      state.transitions.push({ step, status: "running" })
      await dispatchJob(job as never)
    }
    expect(state.jobs.job_tenant_finalize.status).toBe("success")
    expect(state.tenant.status).toBe("active")
  })

  // REGRESSION GUARD (Phase D RAILWAY_URL fix). Pins the fix for the gap this
  // test previously documented: railway_setup MUST itself create+persist
  // railway_api_url / railway_mcp_url so that, with ONLY the real step
  // handlers and NO harness URL reconciliation, domain_finalize's ordering
  // guard passes and the chain reaches `active`. Inverts the old known-bug
  // assertion to lock the behavior in.
  it("REGRESSION GUARD: railway_setup persists railway_*_url so unaided domain_finalize completes", async () => {
    for (const step of ["validate", "supabase_setup", "resend_setup",
      "cloudflare_dns", "vercel_setup", "railway_setup"]) {
      const job = makeJob(step)
      job.status = "running"
      await dispatchJob(job as never)
      expect(job.status).toBe("success")
    }
    // railway_setup persisted service IDs AND the public URLs in one upsert.
    expect(state.infra?.railway_api_service_id).toBe(fx.RAILWAY_API_SVC.id)
    expect(state.infra?.railway_mcp_service_id).toBe(fx.RAILWAY_MCP_SVC.id)
    expect(state.infra?.railway_api_url).toBe(fx.RAILWAY_API_SVC.url)
    expect(state.infra?.railway_mcp_url).toBe(fx.RAILWAY_MCP_SVC.url)
    // It derived the environment id then created a domain per service.
    expect(m.getRailwayEnvironmentId).toHaveBeenCalledWith(
      "rtok", fx.RAILWAY_PROJECT.id)
    expect(m.createRailwayServiceDomain).toHaveBeenCalledTimes(2)
    expect(m.createRailwayServiceDomain).toHaveBeenCalledWith(
      "rtok", fx.RAILWAY_ENVIRONMENT.id, fx.RAILWAY_API_SVC.id)
    expect(m.createRailwayServiceDomain).toHaveBeenCalledWith(
      "rtok", fx.RAILWAY_ENVIRONMENT.id, fx.RAILWAY_MCP_SVC.id)

    // domain_finalize's ordering guard now passes WITHOUT any workaround:
    // it runs to success and the chain can reach `active`.
    const dfJob = makeJob("domain_finalize")
    dfJob.status = "running"
    await dispatchJob(dfJob as never)
    expect(dfJob.status).toBe("success")
    expect(dfJob.last_error).toBeNull()
    expect(m.pollRailwayHealthz).toHaveBeenCalled()

    const tfJob = makeJob("tenant_finalize")
    tfJob.status = "running"
    await dispatchJob(tfJob as never)
    expect(tfJob.status).toBe("success")
    expect(state.tenant.status).toBe("active")
  })
})
