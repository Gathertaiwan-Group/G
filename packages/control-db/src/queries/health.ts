import type { SupabaseClient } from "@supabase/supabase-js"
import type { HealthRow } from "../types"

export async function recordHealth(c: SupabaseClient, row: Omit<HealthRow, "checked_at">) {
  const { error } = await c.from("tenant_health_log").insert(row)
  if (error) throw error
}

export async function recentHealth(c: SupabaseClient, tenantId: string, hours = 24): Promise<HealthRow[]> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  const { data, error } = await c.from("tenant_health_log").select("*")
    .eq("tenant_id", tenantId).gte("checked_at", since).order("checked_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as HealthRow[]
}

export async function consecutiveFailures(c: SupabaseClient, tenantId: string): Promise<number> {
  const recent = await recentHealth(c, tenantId, 1)
  let streak = 0
  for (const r of recent) {
    if (r.vercel_ok && r.api_ok && r.mcp_ok && r.supabase_ok) break
    streak++
  }
  return streak
}
