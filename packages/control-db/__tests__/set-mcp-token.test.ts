import { describe, it, expect, vi } from "vitest"
import { createHash } from "node:crypto"
import { hashMcpToken, setMcpTokenHash } from "../src/queries/infrastructure"

// The live MCP server (apps/mcp/src/lib/auth.ts) authenticates a bearer token
// by computing sha256hex(token) and matching tenant_infrastructure.mcp_token_hash.
// Rotation MUST therefore persist sha256(newToken) so the new token works and
// the old token's (different) hash stops matching immediately. The plan's
// bcrypt code predates the merged sha256 auth path — adapted to the real scheme.
function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

describe("hashMcpToken", () => {
  it("returns a 32-byte hex plaintext token and its sha256 hex hash", () => {
    const { token, hash } = hashMcpToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/) // 32 random bytes hex
    expect(hash).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
    expect(hash).not.toBe(token)
    // hash is exactly what the MCP server will compute for this token
    expect(hash).toBe(sha256hex(token))
  })

  it("verifies the plaintext against the stored hash and rejects others", () => {
    const { token, hash } = hashMcpToken()
    expect(sha256hex(token)).toBe(hash) // correct token → matches
    expect(sha256hex(token + "x")).not.toBe(hash) // tampered token → no match
  })

  it("produces a fresh random token on every call", () => {
    const a = hashMcpToken()
    const b = hashMcpToken()
    expect(a.token).not.toBe(b.token)
    expect(a.hash).not.toBe(b.hash)
  })
})

describe("setMcpTokenHash", () => {
  it("writes the hash onto exactly the one tenant's infrastructure row", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    const c = { from: vi.fn().mockReturnValue({ update }) } as never

    await setMcpTokenHash(c, "ten-1", "deadbeef")

    expect((c as { from: ReturnType<typeof vi.fn> }).from).toHaveBeenCalledWith(
      "tenant_infrastructure",
    )
    expect(update).toHaveBeenCalledWith({ mcp_token_hash: "deadbeef" })
    expect(eq).toHaveBeenCalledWith("tenant_id", "ten-1")
  })

  it("throws when the update errors (old hash must not silently survive)", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: "boom" } })
    const update = vi.fn().mockReturnValue({ eq })
    const c = { from: vi.fn().mockReturnValue({ update }) } as never
    await expect(setMcpTokenHash(c, "t", "h")).rejects.toThrow(/boom/)
  })
})
