import { describe, it, expect, vi, beforeEach } from "vitest"

// ADAPTATION (matches the repo's existing step-resend.test.ts / PR-D6/D7
// pattern): the plan's snippet declares mock fns as plain top-level `const`s
// referenced inside hoisted `vi.mock` factories → "Cannot access ... before
// initialization". We move mock state into vi.hoisted() exactly as PR-D7 did,
// keeping every one of the plan's assertions verbatim.
const {
  createVercelProject, setVercelEnv, triggerVercelDeploy, pollVercelReady,
  upsertInfrastructure,
} = vi.hoisted(() => ({
  createVercelProject: vi.fn(),
  setVercelEnv: vi.fn(),
  triggerVercelDeploy: vi.fn(),
  pollVercelReady: vi.fn(),
  upsertInfrastructure: vi.fn(),
}))
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
  it("isComplete false when no vercel_project_id", async () => {
    expect(await vercelSetupHandler.isComplete(ctx(null))).toBe(false)
  })
  it("throws and does not persist when VERCEL_TOKEN unset", async () => {
    delete process.env.VERCEL_TOKEN
    await expect(vercelSetupHandler.run({ ...ctx(null),
      infra: { supabase_url: "https://ref.supabase.co", supabase_anon_key: "anon" } } as never))
      .rejects.toThrow("VERCEL_TOKEN not set")
    expect(createVercelProject).not.toHaveBeenCalled()
    expect(upsertInfrastructure).not.toHaveBeenCalled()
  })
  it("throws when supabase infra missing (ordering guard)", async () => {
    await expect(vercelSetupHandler.run(ctx(null)))
      .rejects.toThrow("supabase_setup must complete before vercel_setup")
    expect(createVercelProject).not.toHaveBeenCalled()
  })
  it("propagates mgmt-API failure and does not persist", async () => {
    triggerVercelDeploy.mockRejectedValueOnce(new Error("vercel 500"))
    await expect(vercelSetupHandler.run({ ...ctx(null),
      infra: { supabase_url: "https://ref.supabase.co", supabase_anon_key: "anon" } } as never))
      .rejects.toThrow("vercel 500")
    expect(upsertInfrastructure).not.toHaveBeenCalled()
  })
})
