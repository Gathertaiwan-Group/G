import { describe, it, expect } from "vitest"
import { isEnabled, getModuleConfig } from "../src/check"

function fakeSupabase(value: unknown, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: value === undefined ? null : { value }, error }),
        }),
      }),
    }),
  } as never
}

describe("isEnabled", () => {
  it("returns true when module is on in DB and has no deps", async () => {
    expect(await isEnabled(fakeSupabase({ courses: true }), "courses")).toBe(true)
  })

  it("returns false when key missing in DB row", async () => {
    expect(await isEnabled(fakeSupabase({}), "courses")).toBe(false)
  })

  it("propagates DB errors instead of returning false", async () => {
    await expect(
      isEnabled(fakeSupabase(undefined, { message: "boom" }), "subscriptions")
    ).rejects.toThrow(/module_config read failed/)
  })

  it("treats genuinely-absent row as all-disabled (no error)", async () => {
    expect(await isEnabled(fakeSupabase(undefined), "courses")).toBe(false)
  })

  it("filters non-boolean values when sanitizing config", async () => {
    expect(await isEnabled(fakeSupabase({ courses: "yes" }), "courses")).toBe(false)
    expect(await isEnabled(fakeSupabase({ courses: 1 }), "courses")).toBe(false)
  })

  it("requires every registered dependency to also be enabled (transitive)", async () => {
    // member_only_products requires membership_tiers (a registered module)
    expect(
      await isEnabled(
        fakeSupabase({ member_only_products: true, membership_tiers: false }),
        "member_only_products"
      )
    ).toBe(false)
    expect(
      await isEnabled(
        fakeSupabase({ member_only_products: true, membership_tiers: true }),
        "member_only_products"
      )
    ).toBe(true)
  })

  it("treats unregistered deps (e.g. payments) as always-enabled virtual modules", async () => {
    // subscriptions.required_modules = ["payments"] but payments is not in the registry
    expect(await isEnabled(fakeSupabase({ subscriptions: true }), "subscriptions")).toBe(true)
  })
})

describe("getModuleConfig", () => {
  it("back-fills all keys with false", async () => {
    const cfg = await getModuleConfig(fakeSupabase({ subscriptions: true }))
    expect(cfg.subscriptions).toBe(true)
    expect(cfg.courses).toBe(false)
    expect(cfg.bookings).toBe(false)
  })
})
