import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuditEntry } from "../types"

export async function emitAudit(c: SupabaseClient, e: AuditEntry): Promise<void> {
  const { error } = await c.from("audit_log").insert(e)
  if (error) throw error
}

export async function listAuditForTenant(c: SupabaseClient, tenantId: string, limit = 100) {
  const { data, error } = await c.from("audit_log").select("*")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit)
  if (error) throw error
  return data ?? []
}

export async function listAuditAll(c: SupabaseClient, limit = 200) {
  const { data, error } = await c.from("audit_log").select("*")
    .order("created_at", { ascending: false }).limit(limit)
  if (error) throw error
  return data ?? []
}
