import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
    rpc: vi.fn(),
  },
}))

vi.mock("../../lib/token-encryption", () => ({
  encryptToken: vi.fn().mockResolvedValue("encrypted-token"),
  decryptToken: vi.fn().mockResolvedValue("plain-token"),
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

const VALID_TOKEN = "valid-token"
const MOCK_USER_ID = "user-123"

function mockSubscriptionsModuleEnabled() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { value: { subscriptions: true } }, error: null }),
  }
}

function mockAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: MOCK_USER_ID, email: "test@example.com" } as never },
    error: null,
  })
}

const mockPlans = [
  { id: "plan-1", name: "月訂單品補充", type: "replenishment", interval: "monthly", price: 990.00 },
  { id: "plan-2", name: "雙月訂單品補充", type: "replenishment", interval: "bimonthly", price: 1800.00 },
  { id: "plan-3", name: "月訂健康禮盒", type: "membership", interval: "monthly", price: 1490.00 },
]

describe("GET /subscription-plans", () => {
  it("returns 200 with active plans (public, no auth required)", async () => {
    const plansQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockPlans, error: null }),
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockSubscriptionsModuleEnabled() as never
      return plansQuery as never
    })

    const res = await request(app).get("/subscription-plans")

    expect(res.status).toBe(200)
    expect(res.body.data).toBeDefined()
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it("returns 200 even without Authorization header", async () => {
    const plansQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockPlans, error: null }),
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockSubscriptionsModuleEnabled() as never
      return plansQuery as never
    })

    const res = await request(app).get("/subscription-plans")
    expect(res.status).toBe(200)
  })
})

describe("PATCH /subscriptions/:id", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Ensure the subscriptions module gate always passes in these tests
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockSubscriptionsModuleEnabled() as never
      return undefined as never
    })
  })

  it("returns 401 without auth token", async () => {
    const res = await request(app)
      .patch("/subscriptions/sub-123")
      .send({ action: "pause" })

    expect(res.status).toBe(401)
  })

  it("returns 401 with invalid Bearer token", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: null } as never,
      error: { message: "Invalid token" } as never,
    })

    const res = await request(app)
      .patch("/subscriptions/sub-123")
      .set("Authorization", "Bearer invalid-token")
      .send({ action: "pause" })

    expect(res.status).toBe(401)
  })

  it("returns 403 when subscription belongs to different user", async () => {
    mockAuth()

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockSubscriptionsModuleEnabled() as never
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: "sub-123", user_id: "other-user", status: "active" },
          error: null,
        }),
      } as never
    })

    const res = await request(app)
      .patch("/subscriptions/sub-123")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ action: "pause" })

    expect(res.status).toBe(403)
  })

  it("returns 400 for invalid action", async () => {
    mockAuth()

    const res = await request(app)
      .patch("/subscriptions/sub-123")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ action: "invalid-action" })

    expect(res.status).toBe(400)
  })

  it("returns 200 and updated status when pausing own subscription", async () => {
    mockAuth()

    // shared single mock — called twice: once for fetch, once for update
    const single = vi.fn()
      .mockResolvedValueOnce({ data: { id: "sub-123", user_id: MOCK_USER_ID, status: "active" }, error: null })
      .mockResolvedValueOnce({ data: { id: "sub-123", status: "paused", updated_at: new Date().toISOString() }, error: null })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockSubscriptionsModuleEnabled() as never
      return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single,
      } as never
    })

    const res = await request(app)
      .patch("/subscriptions/sub-123")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ action: "pause" })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe("paused")
  })
})

describe("GET /subscriptions", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Ensure the subscriptions module gate always passes in these tests
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockSubscriptionsModuleEnabled() as never
      return undefined as never
    })
  })

  it("returns 401 without auth token", async () => {
    const res = await request(app).get("/subscriptions")
    expect(res.status).toBe(401)
  })

  it("returns 200 with user subscriptions when authenticated", async () => {
    mockAuth()

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockSubscriptionsModuleEnabled() as never
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            { id: "sub-1", plan_id: "plan-1", status: "active", next_billing_date: "2026-04-26", retry_count: 0, created_at: new Date().toISOString() },
          ],
          error: null,
        }),
      } as never
    })

    const res = await request(app)
      .get("/subscriptions")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toBeDefined()
    expect(Array.isArray(res.body.data)).toBe(true)
  })
})
