import type { SupabaseClient } from "@supabase/supabase-js"
import type { Tenant, TenantInfrastructure } from "../types"

export async function listActiveTenants(c: SupabaseClient): Promise<Tenant[]> {
  const { data, error } = await c.from("tenants").select("*").eq("status", "active").order("created_at")
  if (error) throw error
  return (data ?? []) as Tenant[]
}

export async function getTenant(c: SupabaseClient, id: string): Promise<Tenant | null> {
  const { data, error } = await c.from("tenants").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as Tenant | null) ?? null
}

export async function getTenantBySlug(c: SupabaseClient, slug: string): Promise<Tenant | null> {
  const { data, error } = await c.from("tenants").select("*").eq("slug", slug).maybeSingle()
  if (error) throw error
  return (data as Tenant | null) ?? null
}

// Endpoints needed to probe a tenant's running infrastructure (health-check).
export async function getTenantInfrastructure(
  c: SupabaseClient,
  tenantId: string,
): Promise<TenantInfrastructure | null> {
  const { data, error } = await c
    .from("tenant_infrastructure")
    .select("tenant_id, vercel_deployment_url, railway_api_url, railway_mcp_url, supabase_url, supabase_anon_key")
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (error) throw error
  return (data as TenantInfrastructure | null) ?? null
}
