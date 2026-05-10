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

const mockReview = {
  id: "rev-1",
  product_id: "prod-1",
  user_id: "user-1",
  rating: 5,
  content: "非常好的產品，推薦給大家！",
  author_name: "測試用戶",
  author_email: "user@test.com",
  is_approved: true,
  created_at: new Date().toISOString(),
}

function mockReviewsModuleEnabled() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { value: { product_reviews: true } }, error: null }),
  }
}

function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "user-admin", email: "admin@test.com" } },
    error: null,
  } as any)
}

function mockUserAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "user-1", email: "user@test.com" } },
    error: null,
  } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// GET /products/:productId/reviews (public)
// ---------------------------------------------------------------------------

describe("GET /products/:productId/reviews", () => {
  it("returns approved reviews for a product", async () => {
    const reviewQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: "rev-1", rating: 5, content: "Great!", author_name: "User", created_at: mockReview.created_at }],
        error: null,
      }),
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockReviewsModuleEnabled() as any
      return reviewQuery as any
    })

    const res = await request(app).get("/products/prod-1/reviews")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("data")
    expect(res.body).toHaveProperty("averageRating")
    expect(res.body).toHaveProperty("totalCount")
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it("returns empty list and zero averageRating when no reviews", async () => {
    const reviewQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockReviewsModuleEnabled() as any
      return reviewQuery as any
    })

    const res = await request(app).get("/products/prod-1/reviews")
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.averageRating).toBe(0)
    expect(res.body.totalCount).toBe(0)
  })

  it("returns 500 on supabase error", async () => {
    const reviewQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } }),
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockReviewsModuleEnabled() as any
      return reviewQuery as any
    })

    const res = await request(app).get("/products/prod-1/reviews")
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// POST /products/:productId/reviews (auth)
// ---------------------------------------------------------------------------

describe("POST /products/:productId/reviews", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/products/prod-1/reviews")
      .send({ rating: 5, content: "Great product worth buying!" })
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid rating (< 1)", async () => {
    mockUserAuth()

    const res = await request(app)
      .post("/products/prod-1/reviews")
      .set("Authorization", "Bearer valid-token")
      .send({ rating: 0, content: "Bad rating value test content" })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty("error")
  })

  it("returns 400 for invalid rating (> 5)", async () => {
    mockUserAuth()

    const res = await request(app)
      .post("/products/prod-1/reviews")
      .set("Authorization", "Bearer valid-token")
      .send({ rating: 6, content: "Rating too high test content" })
    expect(res.status).toBe(400)
  })

  it("returns 400 for content too short (< 10 chars)", async () => {
    mockUserAuth()

    const res = await request(app)
      .post("/products/prod-1/reviews")
      .set("Authorization", "Bearer valid-token")
      .send({ rating: 5, content: "short" })
    expect(res.status).toBe(400)
  })

  it("creates a review for authenticated user", async () => {
    mockUserAuth()

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockReviewsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { display_name: "測試用戶" }, error: null }),
        } as any
      }
      if (table === "product_reviews") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockReview, error: null }),
        } as any
      }
      return {} as any
    })

    const res = await request(app)
      .post("/products/prod-1/reviews")
      .set("Authorization", "Bearer valid-token")
      .send({ rating: 5, content: "非常好的產品，推薦給大家！" })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty("data")
    expect(res.body.data.rating).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// PATCH /admin/reviews/:id (admin toggle)
// ---------------------------------------------------------------------------

describe("PATCH /admin/reviews/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).patch("/admin/reviews/rev-1")
    expect(res.status).toBe(401)
  })

  it("returns 403 for non-admin", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "user-1", email: "user@test.com" } },
      error: null,
    } as any)
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockReviewsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "customer" }, error: null }),
        } as any
      }
      return {} as any
    })

    const res = await request(app)
      .patch("/admin/reviews/rev-1")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(403)
  })

  it("toggles is_approved for admin", async () => {
    mockAdminAuth()

    const toggled = { ...mockReview, is_approved: false }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockReviewsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      // product_reviews - first call fetches existing, second updates
      const selectSingle = vi.fn()
        .mockResolvedValueOnce({ data: { is_approved: true }, error: null }) // fetch
        .mockResolvedValueOnce({ data: toggled, error: null }) // update result
      return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: selectSingle,
      } as any
    })

    const res = await request(app)
      .patch("/admin/reviews/rev-1")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("data")
  })

  it("returns 404 when review not found", async () => {
    mockAdminAuth()

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockReviewsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
      } as any
    })

    const res = await request(app)
      .patch("/admin/reviews/nonexistent")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// DELETE /admin/reviews/:id
// ---------------------------------------------------------------------------

describe("DELETE /admin/reviews/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).delete("/admin/reviews/rev-1")
    expect(res.status).toBe(401)
  })

  it("returns 403 for non-admin", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "user-1", email: "user@test.com" } },
      error: null,
    } as any)
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockReviewsModuleEnabled() as any
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "editor" }, error: null }),
        } as any
      }
      return {} as any
    })

    const res = await request(app)
      .delete("/admin/reviews/rev-1")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(403)
  })

  it("deletes a review for admin", async () => {
    mockAdminAuth()

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "site_contents") return mockReviewsModuleEnabled() as any
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
      .delete("/admin/reviews/rev-1")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(204)
  })
})
