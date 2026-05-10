import { describe, it, expect, vi, beforeEach } from "vitest"
import type { TenantContext } from "../src/lib/auth"
import type { SupabaseClient } from "@supabase/supabase-js"

function makeSupabaseMock(responses: Record<string, unknown>) {
  const maybeSingle = vi.fn().mockResolvedValue(responses["maybeSingle"] ?? { data: null, error: null })
  const upsert = vi.fn().mockResolvedValue(responses["upsert"] ?? { error: null })
  const limit = vi.fn().mockResolvedValue(responses["limit"] ?? { data: [], error: null })
  const order = vi.fn().mockReturnValue({ limit })
  const eq2 = vi.fn().mockReturnValue({ order, maybeSingle })
  const eq = vi.fn().mockReturnValue({ maybeSingle, order })
  const select = vi.fn().mockReturnValue({ eq, eq2, order })
  const from = vi.fn((table: string) => {
    if (table === "site_contents") {
      return { select, upsert }
    }
    if (table === "orders" || table === "products") {
      return { select: vi.fn().mockReturnValue({ order }) }
    }
    return { select, upsert }
  })

  return { from, select, eq, eq2, maybeSingle, upsert, order, limit } as unknown as SupabaseClient
}

function makeCtx(supabase: SupabaseClient): TenantContext {
  return { tenantId: "tid-1", tenantSlug: "realreal", supabase }
}

describe("get_brand tool", () => {
  it("returns DEFAULT_BRAND when site_contents has no brand row", async () => {
    const { handler } = await import("../src/tools/get_brand")
    const { DEFAULT_BRAND } = await import("@repo/theme")

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await handler({}, makeCtx(supabase))
    expect(result).toEqual(DEFAULT_BRAND)
  })

  it("returns parsed brand when valid data exists", async () => {
    const { handler } = await import("../src/tools/get_brand")
    const { DEFAULT_BRAND } = await import("@repo/theme")

    const brandData = {
      ...DEFAULT_BRAND,
      name: "My Store",
    }

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { value: brandData }, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await handler({}, makeCtx(supabase))
    expect(result.name).toBe("My Store")
  })

  it("returns DEFAULT_BRAND when stored value fails validation", async () => {
    const { handler } = await import("../src/tools/get_brand")
    const { DEFAULT_BRAND } = await import("@repo/theme")

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { value: { name: "broken", colors: {} } },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await handler({}, makeCtx(supabase))
    expect(result).toEqual(DEFAULT_BRAND)
  })
})

describe("update_brand tool", () => {
  it("merges patch with current brand and returns updated brand", async () => {
    const { handler } = await import("../src/tools/update_brand")
    const { DEFAULT_BRAND } = await import("@repo/theme")

    const upsert = vi.fn().mockResolvedValue({ error: null })

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { value: DEFAULT_BRAND },
              error: null,
            }),
          }),
        }),
        upsert,
      }),
    } as unknown as SupabaseClient

    const result = await handler({ patch: { name: "New Name" } }, makeCtx(supabase))
    expect(result.name).toBe("New Name")
    expect(result.colors).toEqual(DEFAULT_BRAND.colors)
    expect(upsert).toHaveBeenCalledOnce()
  })

  it("throws when merged result fails brandSchema validation", async () => {
    const { handler } = await import("../src/tools/update_brand")
    const { DEFAULT_BRAND } = await import("@repo/theme")

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { value: DEFAULT_BRAND },
              error: null,
            }),
          }),
        }),
        upsert: vi.fn(),
      }),
    } as unknown as SupabaseClient

    // Patch with invalid color (too short)
    await expect(
      handler({ patch: { colors: { primary: "#zzz" as never } } }, makeCtx(supabase))
    ).rejects.toThrow()
  })
})

describe("list_modules tool", () => {
  it("returns all MODULE_KEYS with enabled=false when no stored config", async () => {
    const { handler } = await import("../src/tools/list_modules")
    const { MODULE_KEYS } = await import("@repo/modules/src/registry")

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await handler({}, makeCtx(supabase))
    for (const key of MODULE_KEYS) {
      expect(result[key].enabled).toBe(false)
    }
  })
})

describe("set_module_enabled tool", () => {
  it("enables a module with no dependencies", async () => {
    const { handler } = await import("../src/tools/set_module_enabled")

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { value: {} }, error: null }),
          }),
        }),
        upsert,
      }),
    } as unknown as SupabaseClient

    const result = await handler({ module: "campaigns", enabled: true }, makeCtx(supabase))
    expect(result["campaigns"]).toBe(true)
    expect(upsert).toHaveBeenCalledOnce()
  })

  it("rejects enabling member_only_products when membership_tiers is disabled", async () => {
    const { handler } = await import("../src/tools/set_module_enabled")

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { value: { membership_tiers: false } },
              error: null,
            }),
          }),
        }),
        upsert: vi.fn(),
      }),
    } as unknown as SupabaseClient

    await expect(
      handler({ module: "member_only_products", enabled: true }, makeCtx(supabase))
    ).rejects.toThrow(/membership_tiers/)
  })

  it("rejects disabling membership_tiers when member_only_products is enabled", async () => {
    const { handler } = await import("../src/tools/set_module_enabled")

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { value: { membership_tiers: true, member_only_products: true } },
              error: null,
            }),
          }),
        }),
        upsert: vi.fn(),
      }),
    } as unknown as SupabaseClient

    await expect(
      handler({ module: "membership_tiers", enabled: false }, makeCtx(supabase))
    ).rejects.toThrow(/member_only_products/)
  })
})

describe("list_orders tool", () => {
  it("returns orders from supabase", async () => {
    const { handler } = await import("../src/tools/list_orders")

    const fakeOrders = [
      { id: "o1", total: 100, status: "paid", created_at: "2026-01-01T00:00:00Z", customer_email: "a@b.com" },
    ]

    const limit = vi.fn().mockResolvedValue({ data: fakeOrders, error: null })
    const order = vi.fn().mockReturnValue({ limit })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ order, eq })

    const supabase = {
      from: vi.fn().mockReturnValue({ select }),
    } as unknown as SupabaseClient

    const result = await handler({ limit: 10 }, makeCtx(supabase))
    expect(result).toEqual(fakeOrders)
  })
})

describe("list_products tool", () => {
  it("returns products from supabase", async () => {
    const { handler } = await import("../src/tools/list_products")

    const fakeProducts = [
      { id: "p1", slug: "test-product", name: "Test Product", price: 200, in_stock: true },
    ]

    const limit = vi.fn().mockResolvedValue({ data: fakeProducts, error: null })
    const order = vi.fn().mockReturnValue({ limit })
    const select = vi.fn().mockReturnValue({ order })

    const supabase = {
      from: vi.fn().mockReturnValue({ select }),
    } as unknown as SupabaseClient

    const result = await handler({ limit: 10 }, makeCtx(supabase))
    expect(result).toEqual(fakeProducts)
  })
})

describe("update_homepage_copy tool", () => {
  it("stores the value and returns it", async () => {
    const { handler } = await import("../src/tools/update_homepage_copy")

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: vi.fn().mockReturnValue({ upsert }),
    } as unknown as SupabaseClient

    const result = await handler(
      { key: "hero", value: { title: "Hello World", subtitle: "Welcome" } },
      makeCtx(supabase)
    )
    expect(result.key).toBe("hero")
    expect(result.value).toEqual({ title: "Hello World", subtitle: "Welcome" })
    expect(upsert).toHaveBeenCalledWith(
      { key: "homepage_hero", value: { title: "Hello World", subtitle: "Welcome" } },
      { onConflict: "key" }
    )
  })
})
