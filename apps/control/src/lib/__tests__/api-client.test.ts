import { describe, it, expect, vi, beforeEach } from "vitest"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

process.env.RAILWAY_API_URL = "http://test-api:4000"
process.env.INTERNAL_API_SECRET = "test-secret"

const { apiClient } = await import("../api-client")

describe("apiClient", () => {
  beforeEach(() => mockFetch.mockReset())

  it("calls correct URL", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    await apiClient("/health")
    expect(mockFetch).toHaveBeenCalledWith(
      "http://test-api:4000/health",
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    )
  })

  it("attaches Bearer token when provided", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    await apiClient("/orders", { token: "abc123" })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer abc123" }),
      })
    )
  })

  it("attaches internal secret when internal=true", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    await apiClient("/internal", { internal: true })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Internal-Secret": "test-secret" }),
      })
    )
  })

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ message: "Not found" }),
    })
    await expect(apiClient("/missing")).rejects.toThrow("Not found")
  })
})
