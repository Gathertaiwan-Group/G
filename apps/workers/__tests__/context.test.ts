import { describe, it, expect, vi, beforeEach } from "vitest"

// NOTE: the plan's snippet used a static top-level `import` of the SUT plus
// `vi.doMock` (which is NOT hoisted), so the real @realreal/control-db loaded
// before the mock registered. We faithfully keep the plan's two assertions
// (join + not-found throw) but use the correct reset-modules + dynamic-import
// pattern, and include `loadKek` in the mock (context.ts imports it).
describe("loadTenantContext", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("joins tenant + infrastructure into a single context", async () => {
    const getTenant = vi.fn().mockResolvedValue({ id: "t1", slug: "foo",
      custom_domain: null, status: "provisioning", plan: "standard" })
    const getInfrastructure = vi.fn().mockResolvedValue({ tenant_id: "t1",
      supabase_project_ref: "ref" })
    vi.doMock("@realreal/control-db", () => ({
      tenants: { getTenant },
      infrastructure: { getInfrastructure },
      loadKek: vi.fn().mockReturnValue(Buffer.alloc(32)),
    }))
    const { loadTenantContext } = await import("../src/provisioning/context")
    const ctx = await loadTenantContext({} as never, "t1")
    expect(ctx.tenant.slug).toBe("foo")
    expect(ctx.infra?.supabase_project_ref).toBe("ref")
    expect(ctx.platformDomain).toBe("foo.platform.realreal.cc")
  })

  it("throws if tenant not found", async () => {
    vi.doMock("@realreal/control-db", () => ({
      tenants: { getTenant: vi.fn().mockResolvedValue(null) },
      infrastructure: { getInfrastructure: vi.fn() },
      loadKek: vi.fn().mockReturnValue(Buffer.alloc(32)),
    }))
    const { loadTenantContext: load } = await import("../src/provisioning/context")
    await expect(load({} as never, "missing")).rejects.toThrow(/tenant missing not found/)
  })
})
