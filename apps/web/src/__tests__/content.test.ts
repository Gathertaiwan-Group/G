import { describe, it, expect, beforeEach, vi } from "vitest"
import { getSiteContent, getPosts, getPostBySlug, getBrand } from "@/lib/content"
import { DEFAULT_BRAND } from "@repo/theme"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  fetchMock.mockReset()
})

/* ---- getSiteContent ---- */

describe("getSiteContent", () => {
  it("returns data from .data field", async () => {
    const content = { hero: "Welcome" }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: content }),
    })
    const result = await getSiteContent("homepage")
    expect(result).toEqual(content)
    expect(fetchMock.mock.calls[0][0]).toContain("/site-contents/homepage")
  })

  it("falls back to .value field when .data is missing", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: "hello" }),
    })
    const result = await getSiteContent("greeting")
    expect(result).toBe("hello")
  })

  it("falls back to the raw json object when both .data and .value are missing", async () => {
    const raw = { custom: "payload" }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => raw,
    })
    const result = await getSiteContent("raw-key")
    expect(result).toEqual(raw)
  })

  it("returns null when API returns non-ok", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })
    const result = await getSiteContent("missing")
    expect(result).toBeNull()
  })

  it("returns null when fetch throws (network error)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"))
    const result = await getSiteContent("down")
    expect(result).toBeNull()
  })
})

/* ---- getBrand ---- */

describe("getBrand", () => {
  it("returns parsed brand from API when site_contents.brand is valid", async () => {
    const valid = {
      name: "Tenant Co",
      tagline: "Hello world",
      logo_url: "/logo.svg",
      favicon_url: "/favicon.ico",
      colors: {
        primary: "#10305a",
        primary_foreground: "#ffffff",
        accent: "#fffeee",
        background: "#ffffff",
        foreground: "#687279",
      },
      font_family: "gill-sans",
    }
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: valid }) })
    const brand = await getBrand()
    expect(brand.name).toBe("Tenant Co")
    expect(brand.colors.primary).toBe("#10305a")
  })

  it("returns DEFAULT_BRAND when API returns null/missing", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })
    const brand = await getBrand()
    expect(brand).toEqual(DEFAULT_BRAND)
  })

  it("returns DEFAULT_BRAND when API returns malformed brand", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { name: "", logo_url: "javascript:alert(1)" } }),
    })
    const brand = await getBrand()
    expect(brand).toEqual(DEFAULT_BRAND)
  })

  it("returns DEFAULT_BRAND when fetch throws (network error)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network down"))
    const brand = await getBrand()
    expect(brand).toEqual(DEFAULT_BRAND)
  })

  it("returns DEFAULT_BRAND when API returns ok but data is null", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })
    const brand = await getBrand()
    expect(brand).toEqual(DEFAULT_BRAND)
  })
})

/* ---- getSiteContent homepage_* fallback behaviour ---- */

describe("getSiteContent homepage_* keys", () => {
  it("homepage_hero returns null on 404 → caller uses hardcoded fallback", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await getSiteContent<{ heading?: string }>("homepage_hero")
    expect(result).toBeNull()
    // Caller-side fallback: result?.heading ?? "自純淨中補給，在誠真中安心"
    const heading = result?.heading ?? "自純淨中補給，在誠真中安心"
    expect(heading).toBe("自純淨中補給，在誠真中安心")
  })

  it("homepage_hero returns data when API responds", async () => {
    const heroData = { heading: "TEST HEADING", eyebrow: "Test eyebrow" }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: heroData }),
    })
    const result = await getSiteContent<{ heading?: string; eyebrow?: string }>("homepage_hero")
    expect(result?.heading).toBe("TEST HEADING")
    expect(result?.eyebrow).toBe("Test eyebrow")
  })

  it("homepage_banner returns null on network error → caller uses default messages", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"))
    const result = await getSiteContent<{ messages?: string[] }>("homepage_banner")
    expect(result).toBeNull()
    // Caller-side fallback
    const messages = result?.messages ?? ["加入會員立即享 95 折優惠"]
    expect(messages).toContain("加入會員立即享 95 折優惠")
  })

  it("homepage_banner returns messages array when API responds", async () => {
    const bannerData = { messages: ["Free shipping on orders over 500", "Members get 5% off"] }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: bannerData }),
    })
    const result = await getSiteContent<{ messages?: string[] }>("homepage_banner")
    expect(result?.messages).toHaveLength(2)
    expect(result?.messages?.[0]).toBe("Free shipping on orders over 500")
  })

  it("homepage_section_titles returns null on 404 → caller uses hardcoded section titles", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await getSiteContent<{ protein?: string; fruit?: string }>("homepage_section_titles")
    expect(result).toBeNull()
    const proteinTitle = result?.protein ?? "純植物蛋白粉"
    const fruitTitle = result?.fruit ?? "原相凍乾水果"
    expect(proteinTitle).toBe("純植物蛋白粉")
    expect(fruitTitle).toBe("原相凍乾水果")
  })

  it("homepage_membership_image returns null on 404 → caller uses hardcoded URL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await getSiteContent<{ url: string }>("homepage_membership_image")
    expect(result).toBeNull()
    const url = result?.url ?? "https://realreal.cc/wp-content/uploads/2026/01/會員制度表0106-2.png"
    expect(url).toBe("https://realreal.cc/wp-content/uploads/2026/01/會員制度表0106-2.png")
  })
})

/* ---- getPosts ---- */

describe("getPosts", () => {
  it("returns posts and total", async () => {
    const payload = {
      data: [{ id: "1", slug: "hello", title: "Hello World" }],
      total: 1,
    }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    })
    const result = await getPosts()
    expect(result).toEqual(payload)
  })

  it("passes pagination and category params", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0 }),
    })
    await getPosts({ page: 3, limit: 5, category: "news" })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain("page=3")
    expect(url).toContain("limit=5")
    expect(url).toContain("category=news")
  })

  it("returns empty data when API is down", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })
    const result = await getPosts()
    expect(result).toEqual({ data: [], total: 0 })
  })
})

/* ---- getPostBySlug ---- */

describe("getPostBySlug", () => {
  it("returns the post from .data field", async () => {
    const post = { id: "1", slug: "hello", title: "Hello World" }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: post }),
    })
    const result = await getPostBySlug("hello")
    expect(result).toEqual(post)
    expect(fetchMock.mock.calls[0][0]).toContain("/posts/hello")
  })

  it("falls back to the raw json when .data is undefined", async () => {
    const post = { id: "2", slug: "raw", title: "Raw" }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => post,
    })
    const result = await getPostBySlug("raw")
    expect(result).toEqual(post)
  })

  it("returns null for 404", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await getPostBySlug("missing")
    expect(result).toBeNull()
  })

  it("returns null when fetch throws (network error)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Connection refused"))
    const result = await getPostBySlug("offline")
    expect(result).toBeNull()
  })
})
