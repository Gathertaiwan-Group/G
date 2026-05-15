import { describe, it, expect, vi, beforeEach } from "vitest"

// ADAPTATION (matches the repo's existing step-supabase.test.ts pattern): the
// plan's snippet declares mock fns as plain top-level `const`s referenced inside
// hoisted `vi.mock` factories → "Cannot access ... before initialization". We
// move mock state into vi.hoisted() exactly as PR-D6 did, keeping every one of
// the plan's assertions verbatim.
const { addResendDomain, upsertInfrastructure } = vi.hoisted(() => ({
  addResendDomain: vi.fn(),
  upsertInfrastructure: vi.fn(),
}))
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
  it("isComplete false for BYO when no domain id stored yet", async () => {
    expect(await resendSetupHandler.isComplete(ctx("x.com", null))).toBe(false)
  })
  it("throws when RESEND_API_KEY missing (no infra write)", async () => {
    delete process.env.RESEND_API_KEY
    await expect(resendSetupHandler.run(ctx("mybrand.com"))).rejects.toThrow(/RESEND_API_KEY/)
    expect(addResendDomain).not.toHaveBeenCalled()
    expect(upsertInfrastructure).not.toHaveBeenCalled()
  })
  it("mgmt-API failure: throws and never persists infra", async () => {
    addResendDomain.mockRejectedValue(new Error("addResendDomain 500: boom"))
    await expect(resendSetupHandler.run(ctx("mybrand.com"))).rejects.toThrow(/boom/)
    expect(upsertInfrastructure).not.toHaveBeenCalled()
  })
})
