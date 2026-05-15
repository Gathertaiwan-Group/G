import { describe, it, expect, vi, afterEach } from "vitest"
import { renderWelcomeEmail } from "../src/provisioning/notify"

afterEach(() => vi.unstubAllGlobals())

describe("renderWelcomeEmail", () => {
  it("includes site URL, MCP endpoint, the one-time token, and the docs link", () => {
    const { subject, text, html } = renderWelcomeEmail({
      brandName: "Mybrand", slug: "mybrand",
      siteUrl: "https://mybrand.platform.realreal.cc",
      mcpUrl: "https://mcp-mybrand.up.railway.app/mcp",
      mcpToken: "deadbeef".repeat(8),
    })
    expect(subject).toContain("Mybrand")
    for (const s of [
      "https://mybrand.platform.realreal.cc",
      "https://mcp-mybrand.up.railway.app/mcp",
      "deadbeef".repeat(8),
      "shown once",
    ]) {
      expect(text).toContain(s)
      expect(html).toContain(s)
    }
    expect(text).toMatch(/mcp-usage|connect/i)
  })

  it("does not leak the token into any log line (renderer is pure, no logging)", () => {
    const logSpy = vi.fn()
    vi.stubGlobal("console", { ...console, log: logSpy, info: logSpy, warn: logSpy, error: logSpy })
    renderWelcomeEmail({
      brandName: "Mybrand", slug: "mybrand",
      siteUrl: "https://mybrand.platform.realreal.cc",
      mcpUrl: "https://mcp-mybrand.up.railway.app/mcp",
      mcpToken: "topsecrettoken",
    })
    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("topsecrettoken")
    }
  })
})
