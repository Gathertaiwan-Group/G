import type { SupabaseClient } from "@supabase/supabase-js"
import { encrypt } from "../crypto"
import type { TenantInfrastructure } from "../types"

export interface InfraPatch {
  supabase_project_ref?: string
  supabase_url?: string
  supabase_anon_key?: string
  supabase_service_role_key?: string
  vercel_project_id?: string
  vercel_deployment_url?: string
  railway_project_id?: string
  railway_api_service_id?: string
  railway_api_url?: string
  railway_mcp_service_id?: string
  railway_mcp_url?: string
  resend_domain_id?: string
  cloudflare_zone_id?: string
  mcp_token_hash?: string
}

export async function upsertInfrastructure(
  c: SupabaseClient, tenantId: string, patch: InfraPatch, kek: Buffer,
): Promise<void> {
  const { supabase_service_role_key, ...rest } = patch
  const row: Record<string, unknown> = { tenant_id: tenantId, ...rest }
  if (supabase_service_role_key !== undefined) {
    row.supabase_service_role_key_encrypted = encrypt(supabase_service_role_key, kek)
  }
  const { error } = await c.from("tenant_infrastructure")
    .upsert(row, { onConflict: "tenant_id" })
  if (error) throw error
}

export async function getInfrastructure(
  c: SupabaseClient, tenantId: string,
): Promise<TenantInfrastructure | null> {
  const { data, error } = await c.from("tenant_infrastructure")
    .select("*").eq("tenant_id", tenantId).maybeSingle()
  if (error) throw error
  return (data as TenantInfrastructure | null) ?? null
}
