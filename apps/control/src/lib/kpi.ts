// Spec §9 "KPIs visible on the dashboard home". Pure function over already
// fetched rows so it is unit-testable without a DB.
//
// Note (spec ambiguity #4): `tenant_5xx_total_last_hour` has no in-scope data
// source in Phases A–D — there is no per-tenant 5xx log aggregation table. The
// field is kept in the contract and fed an empty array by the page (→ 0) so the
// KPI is present and documented without inventing a log-aggregation source.
export interface KpiInput {
  activeTenants: number
  provisioningDurationsSec: number[]
  tenant5xxLastHour: { tenant_id: string; count: number }[]
  mcpCallsLastHour: { tenant_id: string; total: number; errors: number }[]
  healthStreaks: { tenant_id: string; failure_streak: number }[]
}
export interface Kpis {
  tenant_count_active: number
  provisioning_p95_seconds: number
  tenant_5xx_total_last_hour: number
  mcp_tool_call_count_last_hour: number
  mcp_tool_call_error_rate: number
  max_health_failure_streak: number
}

// Time-window boundaries for the home KPIs. Kept out of the page's render
// body so the impure `Date.now()` read is isolated from React's purity rule
// (react-hooks/purity) — Next 16 / React 19 forbid impure calls during render.
export function kpiWindows(): { since1h: string; since30d: string } {
  const now = Date.now()
  return {
    since1h: new Date(now - 3600_000).toISOString(),
    since30d: new Date(now - 30 * 86400_000).toISOString(),
  }
}

function p95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.min(idx, sorted.length - 1)]
}

export function computeKpis(i: KpiInput): Kpis {
  const totalCalls = i.mcpCallsLastHour.reduce((s, r) => s + r.total, 0)
  const totalErr = i.mcpCallsLastHour.reduce((s, r) => s + r.errors, 0)
  return {
    tenant_count_active: i.activeTenants,
    provisioning_p95_seconds: p95(i.provisioningDurationsSec),
    tenant_5xx_total_last_hour: i.tenant5xxLastHour.reduce((s, r) => s + r.count, 0),
    mcp_tool_call_count_last_hour: totalCalls,
    mcp_tool_call_error_rate: totalCalls === 0 ? 0 : totalErr / totalCalls,
    max_health_failure_streak: i.healthStreaks.reduce(
      (m, r) => Math.max(m, r.failure_streak), 0),
  }
}
