import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
    rpc: vi.fn(),
  },
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

function buildGenericChainable() {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    then: (resolve: any) => resolve({ data: [], error: null, count: 0 }),
  }
  return chain
}

function mockModuleConfig(modules: Record<string, boolean>) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "site_contents") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { value: modules }, error: null }),
      } as any
    }
    return buildGenericChainable() as any
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("module gating in apps/api", () => {
  it("/subscription-plans returns 404 when subscriptions disabled", async () => {
    mockModuleConfig({ subscriptions: false })
    const res = await request(app).get("/subscription-plans")
    expect(res.status).toBe(404)
  })

  it("/posts returns 404 when cms_posts disabled", async () => {
    mockModuleConfig({ cms_posts: false })
    const res = await request(app).get("/posts")
    expect(res.status).toBe(404)
  })
})

// Note: requireModule's per-instance 60s cache means we cannot easily test
// "disabled then enabled" in the same suite — the cached `false` answer would
// persist past a config change. Each gated route is tested for the disabled-404
// path here; the enabled pass-through is exercised by every other test in the
// suite that hits these routes (their happy-path 200/4xx responses prove the
// gate didn't intercept).
describe.each([
  ["subscriptions", "/subscription-plans"],
  ["cms_posts", "/posts"],
  ["product_reviews", "/admin/reviews"],
  ["campaigns", "/admin/campaigns"],
  ["membership_tiers", "/membership-tiers"],
])("module %s gating at %s", (mod, path) => {
  it(`returns 404 with gate error message when ${mod} disabled`, async () => {
    mockModuleConfig({ [mod]: false })
    const res = await request(app).get(path)
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("Not found")
  })
})
