import { describe, it, expect, vi, beforeEach } from "vitest"

// ADAPTATION (matches the repo's existing dispatch.test.ts pattern): the plan's
// snippet declares the mock fns as plain top-level `const`s and references them
// inside `vi.mock` factories, but `vi.mock` is hoisted above those declarations
// → "Cannot access 'upsertInfrastructure' before initialization". We move the
// mock state into vi.hoisted(), exactly as dispatch.test.ts already does, and
// keep every one of the plan's assertions verbatim.
const {
  createSupabaseProject, pollProjectHealthy, fetchProjectApiKeys,
  runTenantSql, configureAuth, createStorageBuckets, upsertInfrastructure,
} = vi.hoisted(() => ({
  createSupabaseProject: vi.fn(),
  pollProjectHealthy: vi.fn(),
  fetchProjectApiKeys: vi.fn(),
  runTenantSql: vi.fn(),
  configureAuth: vi.fn(),
  createStorageBuckets: vi.fn(),
  upsertInfrastructure: vi.fn(),
}))
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
  process.env.PLATFORM_KEK = "0123456789abcdef0123456789abcdef"
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

  // Failure path (task requirement): a Mgmt-API error must propagate so the
  // dispatcher can retry, and NO infra row (hence no key, plaintext or not)
  // may be persisted on a partial failure.
  it("throws on mgmt API failure and does NOT persist infra", async () => {
    createSupabaseProject.mockRejectedValue(new Error("supabase 500: org over quota"))
    await expect(supabaseSetupHandler.run(ctx(null))).rejects.toThrow(/over quota/)
    expect(pollProjectHealthy).not.toHaveBeenCalled()
    expect(upsertInfrastructure).not.toHaveBeenCalled()
  })

  // Phase D hardening (PR-D6 review): the tenant DB password must be a
  // per-tenant CSPRNG secret, NOT a slice of the single PLATFORM_KEK. A KEK
  // compromise/rotation must not imply knowledge of every tenant DB password.
  it("generates a per-tenant db password that is not derived from PLATFORM_KEK", async () => {
    createSupabaseProject.mockResolvedValue({ ref: "ref1", url: "https://ref1.supabase.co" })
    pollProjectHealthy.mockResolvedValue(undefined)
    fetchProjectApiKeys.mockResolvedValue({ anon: "a", serviceRole: "sr" })
    runTenantSql.mockResolvedValue([])
    await supabaseSetupHandler.run(ctx(null))
    const dbPass: string = createSupabaseProject.mock.calls[0][0].dbPass
    const kek = process.env.PLATFORM_KEK as string
    expect(typeof dbPass).toBe("string")
    expect(dbPass.length).toBeGreaterThanOrEqual(24)
    // not the whole KEK, not the old slice(0,24), not any substring of the KEK
    expect(dbPass).not.toBe(kek)
    expect(dbPass).not.toBe(kek.slice(0, 24))
    expect(kek).not.toContain(dbPass)
    expect(dbPass).not.toContain(kek)
  })

  it("generates a fresh random db password on every provisioning run", async () => {
    createSupabaseProject.mockResolvedValue({ ref: "ref1", url: "https://ref1.supabase.co" })
    pollProjectHealthy.mockResolvedValue(undefined)
    fetchProjectApiKeys.mockResolvedValue({ anon: "a", serviceRole: "sr" })
    runTenantSql.mockResolvedValue([])
    await supabaseSetupHandler.run(ctx(null))
    await supabaseSetupHandler.run(ctx(null))
    const p1 = createSupabaseProject.mock.calls[0][0].dbPass
    const p2 = createSupabaseProject.mock.calls[1][0].dbPass
    expect(p1).not.toBe(p2)
  })

  it("persists the db password through the KEK-encrypting upsertInfrastructure patch", async () => {
    createSupabaseProject.mockResolvedValue({ ref: "ref1", url: "https://ref1.supabase.co" })
    pollProjectHealthy.mockResolvedValue(undefined)
    fetchProjectApiKeys.mockResolvedValue({ anon: "a", serviceRole: "sr" })
    runTenantSql.mockResolvedValue([])
    await supabaseSetupHandler.run(ctx(null))
    const dbPass = createSupabaseProject.mock.calls[0][0].dbPass
    const call = upsertInfrastructure.mock.calls[0]
    // Same convention as supabase_service_role_key: plaintext only in the
    // typed patch; upsertInfrastructure KEK-encrypts it before the DB write.
    expect(call[2].supabase_db_password).toBe(dbPass)
    expect(call[3]).toBeInstanceOf(Buffer)
  })

  it("never leaks the db password to non-persistence client calls", async () => {
    createSupabaseProject.mockResolvedValue({ ref: "ref1", url: "https://ref1.supabase.co" })
    pollProjectHealthy.mockResolvedValue(undefined)
    fetchProjectApiKeys.mockResolvedValue({ anon: "a", serviceRole: "sr" })
    runTenantSql.mockResolvedValue([])
    await supabaseSetupHandler.run(ctx(null))
    const dbPass: string = createSupabaseProject.mock.calls[0][0].dbPass
    // The password is legitimately an arg of createSupabaseProject (Supabase
    // Mgmt API needs it to create the project) and of the upsertInfrastructure
    // patch (KEK-encrypted there). It must appear NOWHERE else.
    for (const c of pollProjectHealthy.mock.calls) {
      expect(JSON.stringify(c)).not.toContain(dbPass)
    }
    for (const c of runTenantSql.mock.calls) {
      expect(JSON.stringify(c)).not.toContain(dbPass)
    }
    for (const c of configureAuth.mock.calls) {
      expect(JSON.stringify(c)).not.toContain(dbPass)
    }
    for (const c of createStorageBuckets.mock.calls) {
      expect(JSON.stringify(c)).not.toContain(dbPass)
    }
  })

  it("never passes a plaintext service-role key through any arg but the typed patch", async () => {
    createSupabaseProject.mockResolvedValue({ ref: "ref1", url: "https://ref1.supabase.co" })
    pollProjectHealthy.mockResolvedValue(undefined)
    fetchProjectApiKeys.mockResolvedValue({ anon: "a", serviceRole: "PLAINTEXT_SECRET" })
    runTenantSql.mockResolvedValue([])
    await supabaseSetupHandler.run(ctx(null))
    // The only place the raw key is allowed is the InfraPatch handed to
    // upsertInfrastructure, which KEK-encrypts it before any DB write.
    const call = upsertInfrastructure.mock.calls[0]
    expect(call[2].supabase_service_role_key).toBe("PLAINTEXT_SECRET")
    expect(call[3]).toBeInstanceOf(Buffer)
    // runTenantSql / configureAuth must never receive the secret.
    for (const c of runTenantSql.mock.calls) {
      expect(JSON.stringify(c)).not.toContain("PLAINTEXT_SECRET")
    }
    for (const c of configureAuth.mock.calls) {
      expect(JSON.stringify(c)).not.toContain("PLAINTEXT_SECRET")
    }
  })
})
