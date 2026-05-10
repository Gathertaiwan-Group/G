import { createHash } from "node:crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { createControlClient } from "@realreal/control-db"
import { decryptServiceRoleKey } from "./crypto"

export interface TenantContext {
  tenantId: string
  tenantSlug: string
  supabase: SupabaseClient
}

function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

function loadKek(): Buffer {
  const v = process.env.PLATFORM_KEK
  if (!v) throw new Error("PLATFORM_KEK not set")
  const buf = Buffer.from(v, "hex")
  if (buf.length !== 32) throw new Error("PLATFORM_KEK must be 32 hex bytes (64 chars)")
  return buf
}

/**
 * Parse Authorization header, hash the token, look up tenant_infrastructure,
 * decrypt service_role_key, and return a TenantContext with the tenant's Supabase client.
 *
 * Throws an error (caught by caller and mapped to HTTP 401) if auth fails.
 */
export async function resolveTenant(authHeader: string): Promise<TenantContext> {
  // Parse Bearer token
  const match = /^Bearer\s+(\S+)$/.exec(authHeader)
  if (!match) throw new AuthError("Invalid Authorization header — expected Bearer <token>")
  const token = match[1]

  const tokenHash = sha256hex(token)

  // Look up in control DB
  const control = createControlClient()
  const { data, error } = await control
    .from("tenant_infrastructure")
    .select(
      "tenant_id, supabase_url, supabase_service_role_key_encrypted, tenants!inner(id, slug, status)"
    )
    .eq("mcp_token_hash", tokenHash)
    .maybeSingle()

  if (error) throw new Error(`Control DB error: ${error.message}`)
  if (!data) throw new AuthError("Invalid or unknown MCP token")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenant = (data as any).tenants as { id: string; slug: string; status: string }
  if (tenant.status !== "active") throw new AuthError("Tenant is not active")

  // Decrypt service role key
  // supabase_service_role_key_encrypted comes back from Supabase as a base64 string
  // when the column type is bytea — convert accordingly
  let encryptedBuf: Buffer
  const raw = (data as { supabase_service_role_key_encrypted: unknown }).supabase_service_role_key_encrypted
  if (typeof raw === "string") {
    // Supabase returns bytea as a hex-escaped string like \x<hex> or plain base64
    if (raw.startsWith("\\x")) {
      encryptedBuf = Buffer.from(raw.slice(2), "hex")
    } else {
      encryptedBuf = Buffer.from(raw, "base64")
    }
  } else if (Buffer.isBuffer(raw)) {
    encryptedBuf = raw
  } else {
    throw new Error("Unexpected type for supabase_service_role_key_encrypted")
  }

  const kek = loadKek()
  const serviceRoleKey = decryptServiceRoleKey(encryptedBuf, kek)

  const tenantSupabase = createClient(data.supabase_url, serviceRoleKey, {
    auth: { persistSession: false },
  })

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    supabase: tenantSupabase,
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthError"
  }
}
