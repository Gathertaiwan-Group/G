import { describe, it, expect, vi, beforeEach } from "vitest"
import { validateHandler } from "../src/provisioning/steps/validate"

// ADAPTATION (matches the repo's existing context.test.ts header note): the
// plan's snippet statically imports the SUT and then uses vi.doMock WITHOUT
// vi.resetModules(), so the real @realreal/control-db loads before the mock
// registers and `ctx.client.from` is undefined. We keep the plan's exact three
// assertions but use the correct reset-modules + dynamic-import pattern for the
// mocked case, identical to how context.test.ts resolved the same defect.
const ctx = (slug: string, customDomain: string | null = null) => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: `${slug}.platform.realreal.cc`,
  infra: null,
  tenant: { id: "t1", slug, custom_domain: customDomain, status: "pending_payment",
            owner_user_id: "u1", plan: "standard" },
}) as never

describe("validate step", () => {
  beforeEach(() => {
    vi.resetModules()
  })

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
