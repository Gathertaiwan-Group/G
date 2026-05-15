import { describe, it, expect, vi, beforeEach } from "vitest"

// ADAPTATION (matches the repo's existing step-railway.test.ts / PR-D7/D8
// pattern): the plan's snippet declares mock fns as plain top-level `const`s
// referenced inside hoisted `vi.mock` factories → "Cannot access ... before
// initialization". We move mock state into vi.hoisted() exactly as the prior
// step tests did, keeping every one of the plan's assertions verbatim.
const {
  setVercelEnv, triggerVercelDeploy, pollVercelReady, addVercelDomain,
  pollRailwayHealthz, upsertInfrastructure,
} = vi.hoisted(() => ({
  setVercelEnv: vi.fn(),
  triggerVercelDeploy: vi.fn().mockResolvedValue("dpl_2"),
  pollVercelReady: vi.fn().mockResolvedValue("https://foo.vercel.app"),
  addVercelDomain: vi.fn(),
  pollRailwayHealthz: vi.fn(),
  upsertInfrastructure: vi.fn(),
}))
vi.mock("@realreal/provisioning/clients/vercel", () => ({
  setVercelEnv, triggerVercelDeploy, pollVercelReady, addVercelDomain }))
vi.mock("@realreal/provisioning/clients/railway", () => ({ pollRailwayHealthz }))
vi.mock("@realreal/control-db", () => ({ infrastructure: { upsertInfrastructure } }))
import { domainFinalizeHandler } from "../src/provisioning/steps/domain-finalize"

const ctx = (over: Record<string, unknown> = {}) => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: "foo.platform.realreal.cc",
  tenant: { id: "t1", slug: "foo", custom_domain: null },
  infra: { vercel_project_id: "prj_1",
    railway_api_url: "https://api-foo.up.railway.app",
    railway_mcp_url: "https://mcp-foo.up.railway.app" },
  ...over,
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VERCEL_TOKEN = "v"
  triggerVercelDeploy.mockResolvedValue("dpl_2")
  pollVercelReady.mockResolvedValue("https://foo.vercel.app")
})

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

  it("isComplete always false (idempotent reconcile every run)", async () => {
    expect(await domainFinalizeHandler.isComplete(ctx())).toBe(false)
  })

  it("attaches BYO custom domain when set (added unverified until manual gate)", async () => {
    await domainFinalizeHandler.run(ctx({
      tenant: { id: "t1", slug: "foo", custom_domain: "shop.acme.com" } }))
    expect(addVercelDomain).toHaveBeenCalledWith("v", "prj_1", "shop.acme.com")
  })

  it("throws when VERCEL_TOKEN unset and does not touch Vercel", async () => {
    delete process.env.VERCEL_TOKEN
    await expect(domainFinalizeHandler.run(ctx())).rejects.toThrow("VERCEL_TOKEN not set")
    expect(pollRailwayHealthz).not.toHaveBeenCalled()
    expect(setVercelEnv).not.toHaveBeenCalled()
  })

  it("throws when railway/vercel infra incomplete (ordering guard)", async () => {
    await expect(domainFinalizeHandler.run(ctx({ infra: { vercel_project_id: "prj_1" } })))
      .rejects.toThrow("vercel_setup + railway_setup must complete before domain_finalize")
    expect(setVercelEnv).not.toHaveBeenCalled()
  })

  it("propagates mgmt-API failure (dispatcher retries)", async () => {
    pollRailwayHealthz.mockRejectedValueOnce(new Error("railway unhealthy"))
    await expect(domainFinalizeHandler.run(ctx())).rejects.toThrow("railway unhealthy")
    expect(setVercelEnv).not.toHaveBeenCalled()
  })
})
