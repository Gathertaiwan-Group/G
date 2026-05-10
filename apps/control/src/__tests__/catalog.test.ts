import { describe, it, expect, beforeEach, vi } from "vitest"
import { getCategories, getProducts, getProductBySlug } from "@/lib/catalog"

// Mock global fetch
const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  fetchMock.mockReset()
})

/* ---- getCategories ---- */

describe("getCategories", () => {
  it("returns categories from API response", async () => {
    const cats = [
      { id: "1", name: "Protein", slug: "protein", parent_id: null, sort_order: 0 },
      { id: "2", name: "Snacks", slug: "snacks", parent_id: null, sort_order: 1 },
    ]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: cats }),
    })
    const result = await getCategories()
    expect(result).toEqual(cats)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("returns empty array when API returns non-ok status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })
    const result = await getCategories()
    expect(result).toEqual([])
  })

  it("returns empty array when data is null", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: null }),
    })
    const result = await getCategories()
    expect(result).toEqual([])
  })
})

/* ---- getProducts ---- */

describe("getProducts", () => {
  it("returns products and total from API", async () => {
    const payload = { data: [{ id: "p1", name: "Whey", slug: "whey" }], total: 1 }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    })
    const result = await getProducts()
    expect(result).toEqual(payload)
  })

  it("passes query params to the fetch URL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0 }),
    })
    await getProducts({ page: 2, limit: 10, category: "protein", q: "whey", sort: "price_asc" })
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain("page=2")
    expect(calledUrl).toContain("limit=10")
    expect(calledUrl).toContain("category=protein")
    expect(calledUrl).toContain("q=whey")
    expect(calledUrl).toContain("sort=price_asc")
  })

  it("returns empty data when API is down", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })
    const result = await getProducts()
    expect(result).toEqual({ data: [], total: 0 })
  })

  it("does not set params that are undefined", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0 }),
    })
    await getProducts({ page: 1 })
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain("page=1")
    expect(calledUrl).not.toContain("category=")
    expect(calledUrl).not.toContain("q=")
  })
})

/* ---- getProductBySlug ---- */

describe("getProductBySlug", () => {
  it("returns product with variants", async () => {
    const product = {
      id: "p1",
      name: "Whey",
      slug: "whey",
      description: "Great protein",
      images: [],
      is_active: true,
      category_id: "c1",
      created_at: "2025-01-01",
      variants: [{ id: "v1", name: "1kg", price: "500", sale_price: null, stock_qty: 10, sku: null, attributes: null }],
    }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: product }),
    })
    const result = await getProductBySlug("whey")
    expect(result).toEqual(product)
    expect(fetchMock.mock.calls[0][0]).toContain("/products/whey")
  })

  it("returns null for a non-existent slug (404)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await getProductBySlug("no-such-product")
    expect(result).toBeNull()
  })

  it("returns null when API response data is null", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: null }),
    })
    const result = await getProductBySlug("bad-data")
    expect(result).toBeNull()
  })
})
