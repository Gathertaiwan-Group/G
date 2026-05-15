import { describe, it, expect, vi, beforeEach } from "vitest"

// ADAPTATION (matches the repo's existing step-resend.test.ts / PR-D6/D7
// pattern): the plan's snippet declares mock fns as plain top-level `const`s
// referenced inside hoisted `vi.mock` factories → "Cannot access ... before
// initialization". We move mock state into vi.hoisted() exactly as PR-D7 did,
// keeping every one of the plan's assertions verbatim.
const {
  createRailwayProject, createRailwayService, setRailwayVars,
  deployRailwayService, pollRailwayHealthz, upsertInfrastructure,
} = vi.hoisted(() => ({
  createRailwayProject: vi.fn(),
  createRailwayService: vi.fn(),
  setRailwayVars: vi.fn(),
  deployRailwayService: vi.fn(),
  pollRailwayHealthz: vi.fn(),
  upsertInfrastructure: vi.fn(),
}))
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
  it("isComplete false when only one service id stored", async () => {
    expect(await railwaySetupHandler.isComplete(ctx({
      railway_api_service_id: "a" }))).toBe(false)
  })
  it("throws and does not persist when RAILWAY_TOKEN unset", async () => {
    delete process.env.RAILWAY_TOKEN
    await expect(railwaySetupHandler.run(ctx({
      supabase_url: "https://r.supabase.co", supabase_anon_key: "anon" })))
      .rejects.toThrow("RAILWAY_TOKEN not set")
    expect(createRailwayProject).not.toHaveBeenCalled()
    expect(upsertInfrastructure).not.toHaveBeenCalled()
  })
  it("throws when INTERNAL_API_SECRET unset", async () => {
    delete process.env.INTERNAL_API_SECRET
    await expect(railwaySetupHandler.run(ctx({
      supabase_url: "https://r.supabase.co", supabase_anon_key: "anon" })))
      .rejects.toThrow("INTERNAL_API_SECRET not set")
    expect(createRailwayProject).not.toHaveBeenCalled()
  })
  it("throws when supabase infra missing (ordering guard)", async () => {
    await expect(railwaySetupHandler.run(ctx(null)))
      .rejects.toThrow("supabase_setup must complete before railway_setup")
    expect(createRailwayProject).not.toHaveBeenCalled()
  })
  it("propagates mgmt-API failure and does not persist", async () => {
    createRailwayService.mockReset()
    createRailwayService.mockResolvedValueOnce("svc_api")
      .mockRejectedValueOnce(new Error("railway 500"))
    await expect(railwaySetupHandler.run(ctx({
      supabase_url: "https://r.supabase.co", supabase_anon_key: "anon" })))
      .rejects.toThrow("railway 500")
    expect(upsertInfrastructure).not.toHaveBeenCalled()
  })
})
