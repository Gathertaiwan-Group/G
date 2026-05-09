import type { SupabaseClient } from "@supabase/supabase-js"
import type { Tenant } from "../types"

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
