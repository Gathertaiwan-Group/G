import { describe, it, expect } from "vitest"
import { MODULES, MODULE_KEYS } from "../src/registry"

describe("MODULES registry", () => {
  it("exposes all 10 toggleable modules from spec §5", () => {
    expect(MODULE_KEYS.sort()).toEqual([
      "bookings",
      "campaigns",
      "cms_posts",
      "courses",
      "crowdfunding",
      "member_only_products",
      "membership_tiers",
      "product_reviews",
      "site_notice",
      "subscriptions",
    ])
  })

  it("modules with UI surfaces declare at least routes_to_gate or nav_items", () => {
    // member_only_products is a pure permission modifier (no UI surface).
    // site_notice is rendered inline on every page (no dedicated route/nav).
    // Both are intentionally surface-less; the rest must declare a surface.
    const surfaceless = new Set(["member_only_products", "site_notice"])
    for (const key of MODULE_KEYS) {
      if (surfaceless.has(key)) continue
      const m = MODULES[key]
      expect(m.routes_to_gate.length + m.nav_items.length).toBeGreaterThan(0)
    }
  })

  it("subscriptions requires payments dependency", () => {
    expect(MODULES.subscriptions.required_modules).toContain("payments")
  })
})
