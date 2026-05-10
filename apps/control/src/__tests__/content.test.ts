import { describe, it, expect, beforeEach, vi } from "vitest"
import { getSiteContent, getPosts, getPostBySlug } from "@/lib/content"

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
