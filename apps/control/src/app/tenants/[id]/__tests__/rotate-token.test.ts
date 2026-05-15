import { describe, it, expect, vi, beforeEach } from "vitest"

// requirePlatformUser() redirects (throws) for unauthenticated/non-platform
// callers; on success it returns the platform_users row.
const requirePlatformUserMock = vi.fn()
vi.mock("@/lib/auth", () => ({
  requirePlatformUser: () => requirePlatformUserMock(),
}))

const createControlClientMock = vi.fn()
vi.mock("@/lib/control-db", () => ({
  createControlClient: () => createControlClientMock(),
}))

const revalidatePathMock = vi.fn()
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePathMock(p),
}))

// Real control-db: namespaced exports. hashMcpToken is sync and returns
// { token, hash } where hash = sha256hex(token) (the scheme apps/mcp uses).
const setMcpTokenHashMock = vi.fn()
const emitAuditMock = vi.fn()
const FIXED = {
  token: "a".repeat(64),
  // sha256hex("aaaa...") — irrelevant value; tests assert it is what gets stored
  hash: "b".repeat(64),
}
vi.mock("@realreal/control-db", () => ({
  infrastructure: {
    hashMcpToken: () => FIXED,
    setMcpTokenHash: (...a: unknown[]) => setMcpTokenHashMock(...a),
  },
  audit: { emitAudit: (...a: unknown[]) => emitAuditMock(...a) },
}))

import { rotateMcpToken } from "../token/actions"

const PLATFORM_USER = { id: "admin-1", email: "ops@example.com", auth_user_id: "u1" }

function fakeSupabase() {
  return { from: vi.fn() } as never
}

beforeEach(() => {
  requirePlatformUserMock.mockReset()
  createControlClientMock.mockReset()
  revalidatePathMock.mockReset()
  setMcpTokenHashMock.mockReset()
  emitAuditMock.mockReset()
  setMcpTokenHashMock.mockResolvedValue(undefined)
  emitAuditMock.mockResolvedValue(undefined)
})

function fd(o: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

describe("rotateMcpToken", () => {
  it("rejects unauthorized callers BEFORE any DB access", async () => {
    requirePlatformUserMock.mockRejectedValue(new Error("__redirect:/auth/login"))
    await expect(rotateMcpToken(fd({ tenantId: "t1" }))).rejects.toThrow(
      "__redirect:/auth/login",
    )
    expect(createControlClientMock).not.toHaveBeenCalled()
    expect(setMcpTokenHashMock).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it("throws when tenantId missing (no DB access)", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    await expect(rotateMcpToken(fd({}))).rejects.toThrow(/tenantId required/)
    expect(createControlClientMock).not.toHaveBeenCalled()
    expect(setMcpTokenHashMock).not.toHaveBeenCalled()
  })

  it("stores the NEW token's hash (not the plaintext) and returns plaintext once", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    const client = fakeSupabase()
    createControlClientMock.mockResolvedValue(client)

    const returned = await rotateMcpToken(fd({ tenantId: "t1" }))

    // the plaintext token is returned to the caller exactly once...
    expect(returned).toBe(FIXED.token)
    // ...and what is persisted is the HASH, never the plaintext
    expect(setMcpTokenHashMock).toHaveBeenCalledWith(client, "t1", FIXED.hash)
    const storedArg = setMcpTokenHashMock.mock.calls[0][2]
    expect(storedArg).not.toBe(FIXED.token)
    expect(revalidatePathMock).toHaveBeenCalledWith("/tenants/t1")
  })

  it("never logs the plaintext token", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    createControlClientMock.mockResolvedValue(fakeSupabase())
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )
    try {
      const token = await rotateMcpToken(fd({ tenantId: "t1" }))
      for (const s of spies) {
        for (const call of s.mock.calls) {
          const text = call.map((a) => String(a)).join(" ")
          expect(text).not.toContain(token)
          expect(text).not.toContain(FIXED.hash)
        }
      }
    } finally {
      spies.forEach((s) => s.mockRestore())
    }
  })

  it("writes a platform-admin audit entry for the rotation", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    const client = fakeSupabase()
    createControlClientMock.mockResolvedValue(client)

    await rotateMcpToken(fd({ tenantId: "t1" }))

    expect(emitAuditMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        tenant_id: "t1",
        actor_type: "platform_admin",
        actor_id: "admin-1",
        action: "mcp_token.rotated",
        resource: "tenant_infrastructure:t1",
      }),
    )
    // the audit payload must NOT carry the plaintext token or its hash
    const auditArg = emitAuditMock.mock.calls[0][1] as { payload?: unknown }
    expect(JSON.stringify(auditArg)).not.toContain(FIXED.token)
    expect(JSON.stringify(auditArg)).not.toContain(FIXED.hash)
  })

  it("does NOT write audit if the hash store fails (old token must not appear rotated)", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    createControlClientMock.mockResolvedValue(fakeSupabase())
    setMcpTokenHashMock.mockRejectedValue(new Error("db down"))
    await expect(rotateMcpToken(fd({ tenantId: "t1" }))).rejects.toThrow(/db down/)
    expect(emitAuditMock).not.toHaveBeenCalled()
  })
})
