import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

const mockCampaign = {
  id: "camp-1",
  name: "夏季折扣",
  description: "夏季全館折扣活動",
  tier_id: null,
  type: "discount",
  config: { discount_percent: 10 },
  coupon_id: null,
  is_active: true,
  starts_at: "2026-06-01T00:00:00Z",
  ends_at: "2026-08-31T23:59:59Z",
  created_at: new Date().toISOString(),
  membership_tiers: null,
  coupons: null,
}

function mockCampaignsModuleEnabled() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { value: { campaigns: true } }, error: null }),
  }
}

// Helper: mock auth + admin role
function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "user-admin", email: "admin@test.com" } },
    error: null,
  } as any)
  // requireAdmin / requireEditor reads user_profiles
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "site_contents") return mockCampaignsModuleEnabled() as any
    if (table === "user_profiles") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
      } as any
    }
    return buildCampaignQuery() as any
  })
}

// Helper: mock auth + editor role (editor can GET but not POST/PUT/DELETE admin-only routes)
function mockEditorAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "user-editor", email: "editor@test.com" } },
    error: null,
  } as any)
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "site_contents") return mockCampaignsModuleEnabled() as any
    if (table === "user_profiles") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { role: "editor" }, error: null }),
      } as any
    }
    return buildCampaignQuery() as any
  })
}

function buildCampaignQuery(data: any = [mockCampaign], error: any = null) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
    single: vi.fn().mockResolvedValue({ data: data?.[0] ?? null, error }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: campaigns module is enabled so gate passes for all tests.
  // Individual tests can override supabase.from for specific tables.
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "site_contents") return mockCampaignsModuleEnabled() as any
    return buildCampaignQuery() as any
  })
})

// ---------------------------------------------------------------------------
// GET /admin/campaigns
// ---------------------------------------------------------------------------

describe("GET /admin/campaigns", () => {
  it("returns 401 without auth", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: { message: "invalid token" },
    } as any)

    const res = await request(app).get("/admin/campaigns")
    expect(res.status).toBe(401)
  })

  it("returns 403 for non-editor/non-admin", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "user-1", email: "viewer@test.com" } },
      error: null,
    } as any)
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "customer" }, error: null }),
        } as any
      }
      return buildCampaignQuery() as any
    })

    const res = await request(app)
      .get("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(403)
  })

  it("returns campaigns list for editor", async () => {
    mockEditorAuth()

    const campaignQuery = buildCampaignQuery([mockCampaign])
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "editor" }, error: null }),
        } as any
      }
      return campaignQuery as any
    })

    const res = await request(app)
      .get("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("data")
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it("returns campaigns list for admin", async () => {
    mockAdminAuth()

    const res = await request(app)
      .get("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("data")
  })
})

// ---------------------------------------------------------------------------
// POST /admin/campaigns
// ---------------------------------------------------------------------------

describe("POST /admin/campaigns", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/admin/campaigns")
      .send({ name: "Test", type: "discount", starts_at: "2026-06-01T00:00:00Z" })
    expect(res.status).toBe(401)
  })

  it("returns 403 for editor (admin-only route)", async () => {
    mockEditorAuth()

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Test", type: "discount", starts_at: "2026-06-01T00:00:00Z" })
    expect(res.status).toBe(403)
  })

  it("returns 400 for invalid body (missing required fields)", async () => {
    mockAdminAuth()

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({ description: "missing name and type" })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty("error")
  })

  it("returns 400 for invalid type enum", async () => {
    mockAdminAuth()

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Bad Type", type: "nonexistent_type", starts_at: "2026-06-01T00:00:00Z" })
    expect(res.status).toBe(400)
  })

  it("creates a discount campaign", async () => {
    mockAdminAuth()

    const created = { ...mockCampaign, type: "discount" }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: created, error: null }),
      } as any
    })

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "夏季折扣", type: "discount", starts_at: "2026-06-01T00:00:00Z" })
    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe("discount")
  })

  it("creates a buy_x_get_y campaign", async () => {
    mockAdminAuth()

    const created = { ...mockCampaign, type: "buy_x_get_y", config: { buy: 3, get: 1 } }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: created, error: null }),
      } as any
    })

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({
        name: "買三送一",
        type: "buy_x_get_y",
        config: { buy: 3, get: 1 },
        starts_at: "2026-06-01T00:00:00Z",
      })
    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe("buy_x_get_y")
  })

  it("creates a second_half_price campaign", async () => {
    mockAdminAuth()

    const created = { ...mockCampaign, type: "second_half_price" }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: created, error: null }),
      } as any
    })

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "第二件半價", type: "second_half_price", starts_at: "2026-06-01T00:00:00Z" })
    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe("second_half_price")
  })

  it("creates a spend_threshold campaign", async () => {
    mockAdminAuth()

    const created = { ...mockCampaign, type: "spend_threshold", config: { threshold: 1000, discount: 100 } }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: created, error: null }),
      } as any
    })

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({
        name: "滿千折百",
        type: "spend_threshold",
        config: { threshold: 1000, discount: 100 },
        starts_at: "2026-06-01T00:00:00Z",
      })
    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe("spend_threshold")
  })

  it("creates a combo_discount campaign", async () => {
    mockAdminAuth()

    const created = { ...mockCampaign, type: "combo_discount", config: { product_ids: ["p1", "p2"], discount: 50 } }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: created, error: null }),
      } as any
    })

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({
        name: "組合優惠",
        type: "combo_discount",
        config: { product_ids: ["p1", "p2"], discount: 50 },
        starts_at: "2026-06-01T00:00:00Z",
      })
    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe("combo_discount")
  })

  it("creates a freebie campaign", async () => {
    mockAdminAuth()

    const created = { ...mockCampaign, type: "freebie", config: { free_product_id: "p3" } }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: created, error: null }),
      } as any
    })

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({
        name: "贈品活動",
        type: "freebie",
        config: { free_product_id: "p3" },
        starts_at: "2026-06-01T00:00:00Z",
      })
    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe("freebie")
  })

  it("creates a free_shipping campaign", async () => {
    mockAdminAuth()

    const created = { ...mockCampaign, type: "free_shipping" }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: created, error: null }),
      } as any
    })

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "免運費", type: "free_shipping", starts_at: "2026-06-01T00:00:00Z" })
    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe("free_shipping")
  })

  it("creates a points_multiplier campaign", async () => {
    mockAdminAuth()

    const created = { ...mockCampaign, type: "points_multiplier", config: { multiplier: 2 } }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: created, error: null }),
      } as any
    })

    const res = await request(app)
      .post("/admin/campaigns")
      .set("Authorization", "Bearer valid-token")
      .send({
        name: "雙倍點數",
        type: "points_multiplier",
        config: { multiplier: 2 },
        starts_at: "2026-06-01T00:00:00Z",
      })
    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe("points_multiplier")
  })
})

// ---------------------------------------------------------------------------
// PUT /admin/campaigns/:id
// ---------------------------------------------------------------------------

describe("PUT /admin/campaigns/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .put("/admin/campaigns/camp-1")
      .send({ name: "Updated" })
    expect(res.status).toBe(401)
  })

  it("returns 403 for editor", async () => {
    mockEditorAuth()

    const res = await request(app)
      .put("/admin/campaigns/camp-1")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Updated" })
    expect(res.status).toBe(403)
  })

  it("updates a campaign for admin", async () => {
    mockAdminAuth()

    const updated = { ...mockCampaign, name: "Updated Campaign" }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        update: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: updated, error: null }),
      } as any
    })

    const res = await request(app)
      .put("/admin/campaigns/camp-1")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Updated Campaign" })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe("Updated Campaign")
  })
})

// ---------------------------------------------------------------------------
// DELETE /admin/campaigns/:id
// ---------------------------------------------------------------------------

describe("DELETE /admin/campaigns/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).delete("/admin/campaigns/camp-1")
    expect(res.status).toBe(401)
  })

  it("returns 403 for editor", async () => {
    mockEditorAuth()

    const res = await request(app)
      .delete("/admin/campaigns/camp-1")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(403)
  })

  it("deletes a campaign for admin", async () => {
    mockAdminAuth()

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      } as any
    })

    const res = await request(app)
      .delete("/admin/campaigns/camp-1")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(204)
  })
})

// ---------------------------------------------------------------------------
// GET /campaigns/active (public)
// ---------------------------------------------------------------------------

function buildActiveCampaignQuery(data: any, error: any = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
}

describe("GET /campaigns/active", () => {
  it("returns active campaigns without auth", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      return buildActiveCampaignQuery([mockCampaign]) as any
    })

    const res = await request(app).get("/campaigns/active")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("data")
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it("returns empty array when no active campaigns", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      return buildActiveCampaignQuery([]) as any
    })

    const res = await request(app).get("/campaigns/active")
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it("returns 500 when supabase errors", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockCampaignsModuleEnabled() as any
      return buildActiveCampaignQuery(null, { message: "db error" }) as any
    })

    const res = await request(app).get("/campaigns/active")
    expect(res.status).toBe(500)
    expect(res.body.error).toBe("db error")
  })
})
