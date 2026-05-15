import { createHash } from "node:crypto"
import { describe, it, expect, vi, beforeEach } from "vitest"

// Independent re-implementation of apps/mcp/src/lib/auth.ts's sha256hex — the
// test must NOT import the production helper, so it can prove the stored hash
// equals what the live MCP server computes from the plaintext bearer token.
function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

// ADAPTATION (matches the repo's existing step-railway.test.ts / PR-D7/D8
// pattern): plan's plain top-level `const` mocks referenced in hoisted
// vi.mock factories crash with "Cannot access before initialization".
// Mock state moved into vi.hoisted(); every plan assertion kept verbatim.
// hashMcpToken uses the SAME sha256 scheme as the real control-db helper and
// as apps/mcp's sha256hex. We fix the token to a known value so every test can
// independently recompute the expected stored hash with sha256hex() and prove
// the round-trip: stored hash === sha256hex(plaintext token emailed once).
const MCP_TOKEN = "a".repeat(64)
const {
  upsertInfrastructure, updateTenantStatus, runTenantSql, hashMcpToken,
  sendEmail, alertOps,
} = vi.hoisted(() => ({
  upsertInfrastructure: vi.fn(),
  updateTenantStatus: vi.fn(),
  runTenantSql: vi.fn(),
  hashMcpToken: vi.fn(),
  sendEmail: vi.fn(),
  alertOps: vi.fn(),
}))
vi.mock("@realreal/control-db", () => ({
  infrastructure: { upsertInfrastructure, hashMcpToken },
  tenants: { updateTenantStatus } }))
vi.mock("@realreal/provisioning/clients/supabase-mgmt", () => ({ runTenantSql }))
vi.mock("../src/provisioning/notify", () => ({ sendWelcomeEmail: sendEmail, alertOps }))
import { tenantFinalizeHandler } from "../src/provisioning/steps/tenant-finalize"

const ctx = (over: Record<string, unknown> = {}) => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: "foo.platform.realreal.cc",
  tenant: { id: "t1", slug: "foo", custom_domain: null, owner_user_id: "u1" },
  infra: { supabase_project_ref: "ref", supabase_url: "https://ref.supabase.co",
    railway_mcp_url: "https://mcp-foo.up.railway.app" },
  ...over,
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  // Real sha256 scheme (matches packages/control-db's hashMcpToken and
  // apps/mcp's sha256hex), fixed token so the round-trip is assertable.
  hashMcpToken.mockReturnValue({ token: MCP_TOKEN, hash: sha256hex(MCP_TOKEN) })
  process.env.SUPABASE_PAT = "pat"
  process.env.OWNER_ADMIN_EMAIL = "owner@example.com"
})

describe("tenant_finalize", () => {
  it("generates MCP token (hash stored), creates admin, emails, activates", async () => {
    await tenantFinalizeHandler.run(ctx())
    expect(upsertInfrastructure).toHaveBeenCalledWith(expect.anything(), "t1",
      { mcp_token_hash: sha256hex(MCP_TOKEN) }, expect.any(Buffer))
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com", slug: "foo" }))
    expect(updateTenantStatus).toHaveBeenCalledWith(expect.anything(), "t1", "active")
  })

  it("isComplete true once tenant active", async () => {
    const c = ctx() as { tenant: { status?: string } }
    c.tenant.status = "active"
    expect(await tenantFinalizeHandler.isComplete(c as never)).toBe(true)
  })

  it("isComplete false when tenant not yet active", async () => {
    const c = ctx() as { tenant: { status?: string } }
    c.tenant.status = "provisioning"
    expect(await tenantFinalizeHandler.isComplete(c as never)).toBe(false)
  })

  it("creates the virtual MCP admin user via tenant SQL", async () => {
    await tenantFinalizeHandler.run(ctx())
    expect(runTenantSql).toHaveBeenCalledWith("pat", "ref",
      expect.stringContaining("mcp@foo.local"), expect.any(String))
  })

  it("does not store plaintext MCP token (only sha256 hash persisted)", async () => {
    await tenantFinalizeHandler.run(ctx())
    const patch = upsertInfrastructure.mock.calls[0][2] as Record<string, unknown>
    expect(Object.keys(patch)).toEqual(["mcp_token_hash"])
    expect(patch.mcp_token_hash).toBe(sha256hex(MCP_TOKEN))
    expect(patch.mcp_token_hash).not.toBe(MCP_TOKEN)
  })

  // REGRESSION GUARD for the provisioned-tenant auth blocker: apps/mcp matches
  // tenant_infrastructure.mcp_token_hash by EXACT equality against
  // sha256hex(bearerToken). The stored hash must therefore be exactly that
  // sha256 hex digest — never a bcrypt hash (which can never equal it, so
  // every provisioned tenant would 401 forever).
  it("stores sha256hex(plaintext token), NOT a bcrypt hash (round-trip)", async () => {
    await tenantFinalizeHandler.run(ctx())
    // The plaintext token emailed to the operator exactly once.
    const emailed = sendEmail.mock.calls[0][0] as { mcpToken: string }
    const patch = upsertInfrastructure.mock.calls[0][2] as { mcp_token_hash: string }

    // Independently recompute what apps/mcp's sha256hex(token) would produce
    // and prove the stored hash equals it — this is the exact value apps/mcp's
    // `.eq("mcp_token_hash", sha256hex(token))` lookup will match on.
    expect(patch.mcp_token_hash).toBe(sha256hex(emailed.mcpToken))

    // 64-char lowercase hex sha256 digest, and definitively NOT bcrypt.
    expect(patch.mcp_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(patch.mcp_token_hash.startsWith("$2")).toBe(false)
  })

  it("throws and does NOT activate when SUPABASE_PAT unset", async () => {
    delete process.env.SUPABASE_PAT
    await expect(tenantFinalizeHandler.run(ctx())).rejects.toThrow("SUPABASE_PAT not set")
    expect(updateTenantStatus).not.toHaveBeenCalled()
  })

  it("throws and does NOT activate when OWNER_ADMIN_EMAIL unset", async () => {
    delete process.env.OWNER_ADMIN_EMAIL
    await expect(tenantFinalizeHandler.run(ctx())).rejects.toThrow("OWNER_ADMIN_EMAIL not set")
    expect(updateTenantStatus).not.toHaveBeenCalled()
  })

  it("throws when supabase infra missing (ordering guard), no activation", async () => {
    await expect(tenantFinalizeHandler.run(ctx({ infra: {} })))
      .rejects.toThrow("supabase_setup must complete before tenant_finalize")
    expect(updateTenantStatus).not.toHaveBeenCalled()
  })

  it("does NOT activate if welcome email fails (mgmt failure → throw)", async () => {
    sendEmail.mockRejectedValueOnce(new Error("resend 500"))
    await expect(tenantFinalizeHandler.run(ctx())).rejects.toThrow("resend 500")
    expect(updateTenantStatus).not.toHaveBeenCalled()
  })

  it("throws on SQL-injection slug and does NOT activate or run unsafe SQL", async () => {
    const evil = "evil'); drop table users;--"
    await expect(
      tenantFinalizeHandler.run(ctx({
        tenant: { id: "t1", slug: evil, custom_domain: null, owner_user_id: "u1" },
      })),
    ).rejects.toThrow(/invalid tenant slug/i)
    expect(updateTenantStatus).not.toHaveBeenCalled()
    // the raw injected payload must never reach runTenantSql
    expect(runTenantSql).not.toHaveBeenCalledWith(
      "pat", "ref", expect.stringContaining("drop table users"), expect.any(String),
    )
  })

  it("throws on a slug containing a single quote (no activation)", async () => {
    await expect(
      tenantFinalizeHandler.run(ctx({
        tenant: { id: "t1", slug: "ab'c", custom_domain: null, owner_user_id: "u1" },
      })),
    ).rejects.toThrow(/invalid tenant slug/i)
    expect(updateTenantStatus).not.toHaveBeenCalled()
    expect(runTenantSql).not.toHaveBeenCalled()
  })

  it("normal slug: SQL contains the safely single-quoted mcp email", async () => {
    await tenantFinalizeHandler.run(ctx())
    expect(runTenantSql).toHaveBeenCalledWith("pat", "ref",
      expect.stringContaining("'mcp@foo.local'"), expect.any(String))
    expect(updateTenantStatus).toHaveBeenCalledWith(expect.anything(), "t1", "active")
  })
})
