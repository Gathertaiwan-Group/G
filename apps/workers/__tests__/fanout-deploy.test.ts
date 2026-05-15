import { describe, it, expect, vi, beforeEach } from "vitest"

// ADAPTATION (matches the repo's existing step-vercel.test.ts / PR-D6+ pattern):
// the plan's snippet declares the mock fns as plain top-level `const`s and
// references them inside the hoisted `vi.mock` factories, which throws
// "Cannot access '...' before initialization" under vitest@4. We move the
// mock state into vi.hoisted() exactly as the merged step tests do, keeping
// every one of the plan's assertions verbatim, and add the focused --only
// filter test the plan's Step 7 / engineer note requires.
const {
  listActiveTenants, getInfrastructure, emitAudit,
  triggerVercelDeploy, deployRailwayService,
} = vi.hoisted(() => ({
  listActiveTenants: vi.fn(),
  getInfrastructure: vi.fn(),
  emitAudit: vi.fn(),
  triggerVercelDeploy: vi.fn(),
  deployRailwayService: vi.fn(),
}))
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

  it("deploys every active tenant's vercel + both railway services on success", async () => {
    const summary = await fanoutDeploy()
    expect(summary).toEqual({ ok: ["a", "b"], failed: [] })
    expect(triggerVercelDeploy).toHaveBeenCalledWith("v", "prj_tA")
    expect(triggerVercelDeploy).toHaveBeenCalledWith("v", "prj_tB")
    expect(deployRailwayService).toHaveBeenCalledWith("r", "api_tA")
    expect(deployRailwayService).toHaveBeenCalledWith("r", "mcp_tA")
    expect(deployRailwayService).toHaveBeenCalledWith("r", "api_tB")
    expect(deployRailwayService).toHaveBeenCalledWith("r", "mcp_tB")
  })

  it("a tenant with no infrastructure row fails in isolation, siblings continue", async () => {
    getInfrastructure.mockImplementation(async (_c: unknown, id: string) =>
      id === "tA" ? null : {
        tenant_id: id, vercel_project_id: `prj_${id}`,
        railway_api_service_id: `api_${id}`, railway_mcp_service_id: `mcp_${id}` })
    const summary = await fanoutDeploy()
    expect(summary).toEqual({ ok: ["b"], failed: ["a"] })
    expect(emitAudit).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ tenant_id: "tA", action: "fanout_deploy_failed" }))
  })

  it("--only=<slug> filters listActiveTenants down to that one tenant", async () => {
    const summary = await fanoutDeploy("b")
    expect(summary).toEqual({ ok: ["b"], failed: [] })
    expect(triggerVercelDeploy).toHaveBeenCalledTimes(1)
    expect(triggerVercelDeploy).toHaveBeenCalledWith("v", "prj_tB")
    expect(emitAudit).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ tenant_id: "tB", action: "fanout_deploy_ok" }))
  })

  it("--only=<slug> with no matching active tenant deploys nothing", async () => {
    const summary = await fanoutDeploy("does-not-exist")
    expect(summary).toEqual({ ok: [], failed: [] })
    expect(triggerVercelDeploy).not.toHaveBeenCalled()
    expect(deployRailwayService).not.toHaveBeenCalled()
  })
})
