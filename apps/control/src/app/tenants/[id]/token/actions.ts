"use server"
import { revalidatePath } from "next/cache"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { infrastructure, audit } from "@realreal/control-db"

// Spec §8 — platform-admin MCP token rotation (customer self-service rotation
// UI is §13 out of scope). State-mutating, security-sensitive admin action:
//  - requirePlatformUser() guard FIRST, before any client/DB/secret material
//    (same gate as every control mutation).
//  - infrastructure.hashMcpToken() mints a fresh 32-byte token; ONLY its
//    sha256 hash is persisted (apps/mcp/src/lib/auth.ts authenticates by
//    sha256hex(bearer) == tenant_infrastructure.mcp_token_hash, so the old
//    token's differing hash stops matching the instant we overwrite it).
//  - the audit_log entry records the rotation WITHOUT the plaintext or hash.
//  - the plaintext is returned to the caller exactly once for one-time display
//    (apps/control .../token/RotateToken.tsx). It is never persisted, never
//    logged, and never re-readable. Incident response if it leaks anyway:
//    docs/runbooks/mcp-token-leak.md (PR-E5).
export async function rotateMcpToken(formData: FormData): Promise<string> {
  const user = await requirePlatformUser()
  const tenantId = String(formData.get("tenantId") ?? "")
  if (!tenantId) throw new Error("tenantId required")

  const { token, hash } = infrastructure.hashMcpToken()
  const supabase = await createControlClient()
  // store the new hash first; if this throws we do NOT emit an audit entry,
  // so a failed rotation is never recorded as if it had succeeded.
  await infrastructure.setMcpTokenHash(supabase, tenantId, hash)
  await audit.emitAudit(supabase, {
    tenant_id: tenantId,
    actor_type: "platform_admin",
    actor_id: user.id,
    action: "mcp_token.rotated",
    resource: `tenant_infrastructure:${tenantId}`,
    payload: {}, // never the plaintext token or its hash
  })

  revalidatePath(`/tenants/${tenantId}`)
  return token // shown once; the MCP service picks up the new hash on next auth
}
