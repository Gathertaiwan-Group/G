import type { SupabaseClient } from "@supabase/supabase-js"
import type { Tenant, TenantInfrastructure, TenantStatus } from "../types"

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

export interface CreateTenantArgs {
  slug: string
  custom_domain: string | null
  owner_user_id: string
  plan: string | null
}

export async function createTenant(c: SupabaseClient, a: CreateTenantArgs): Promise<string> {
  const { data, error } = await c.from("tenants")
    .insert({
      slug: a.slug,
      custom_domain: a.custom_domain,
      owner_user_id: a.owner_user_id,
      plan: a.plan,
      status: "pending_payment",
    })
    .select("id")
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

// Spec §9 tenant cancellation/suspension. Suspend freezes; resume restores to
// active. Data is preserved (no infra teardown here — that is the §9 30-day
// cron, out of Phase E scope). Status-transition validity (only suspend a
// non-suspended tenant, only resume a suspended one) is enforced by the
// control-plane action layer; these helpers are the raw mutators.
export async function suspendTenant(
  c: SupabaseClient, tenantId: string, reason: string,
): Promise<void> {
  const { error } = await c.from("tenants").update({
    status: "suspended", suspended_at: new Date().toISOString(),
    suspended_reason: reason,
  }).eq("id", tenantId)
  if (error) throw new Error(`suspendTenant(${tenantId}): ${error.message}`)
}

export async function resumeTenant(
  c: SupabaseClient, tenantId: string,
): Promise<void> {
  const { error } = await c.from("tenants").update({
    status: "active", suspended_at: null, suspended_reason: null,
  }).eq("id", tenantId)
  if (error) throw new Error(`resumeTenant(${tenantId}): ${error.message}`)
}

export async function updateTenantStatus(
  c: SupabaseClient, id: string, status: TenantStatus,
  patch: { suspended_reason?: string } = {},
): Promise<void> {
  const u: Record<string, unknown> = { status }
  if (status === "active") u.activated_at = new Date().toISOString()
  if (status === "suspended" || status === "canceled") {
    u.suspended_at = new Date().toISOString()
    if (patch.suspended_reason) u.suspended_reason = patch.suspended_reason
  }
  const { error } = await c.from("tenants").update(u).eq("id", id)
  if (error) throw error
}
