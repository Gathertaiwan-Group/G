import { describe, it, expect, vi } from "vitest"
import { isEnabled, getModuleConfig } from "../src/check"

function fakeSupabase(value: unknown, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: value ? { value } : null, error }) }),
      }),
    }),
  } as never
}

describe("isEnabled", () => {
  it("returns true when module is on in DB", async () => {
    expect(await isEnabled(fakeSupabase({ courses: true }), "courses")).toBe(true)
  })
  it("returns false when key missing in DB row", async () => {
    expect(await isEnabled(fakeSupabase({}), "courses")).toBe(false)
  })
  it("returns false when DB errors", async () => {
    expect(await isEnabled(fakeSupabase(null, { code: "X" }), "subscriptions")).toBe(false)
  })
  it("getModuleConfig back-fills all keys with false", async () => {
    const cfg = await getModuleConfig(fakeSupabase({ subscriptions: true }))
    expect(cfg.subscriptions).toBe(true)
    expect(cfg.courses).toBe(false)
    expect(cfg.bookings).toBe(false)
  })
})
