import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { computeKpis, kpiWindows } from "@/lib/kpi"

export const metadata = { title: "Platform Control" }

export default async function HomePage() {
  await requirePlatformUser()
  const supabase = await createControlClient()

  const { since1h: since, since30d } = kpiWindows()

  const [active, finals, health, mcp] = await Promise.all([
    supabase.from("tenants").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("provisioning_jobs")
      .select("tenant_id, started_at, finished_at")
      .eq("step", "tenant_finalize").eq("status", "success")
      .gte("finished_at", since30d),
    supabase.from("tenant_health_log")
      .select("tenant_id, vercel_ok, api_ok, mcp_ok, supabase_ok, checked_at")
      .gte("checked_at", since).order("checked_at", { ascending: false }),
    supabase.from("audit_log")
      .select("tenant_id, action")
      .eq("actor_type", "customer_agent").gte("created_at", since),
  ])

  const durations = (finals.data ?? [])
    .filter(r => r.started_at && r.finished_at)
    .map(r => (Date.parse(r.finished_at!) - Date.parse(r.started_at!)) / 1000)

  // streak = consecutive most-recent non-ok per tenant
  const streakByTenant = new Map<string, number>()
  for (const h of health.data ?? []) {
    const ok = h.vercel_ok && h.api_ok && h.mcp_ok && h.supabase_ok
    if (streakByTenant.get(h.tenant_id) === -1) continue
    if (!ok) streakByTenant.set(h.tenant_id, (streakByTenant.get(h.tenant_id) ?? 0) + 1)
    else streakByTenant.set(h.tenant_id, -1)
  }
  const healthStreaks = [...streakByTenant].map(([tenant_id, s]) =>
    ({ tenant_id, failure_streak: s === -1 ? 0 : s }))

  const callsByTenant = new Map<string, { total: number; errors: number }>()
  for (const a of mcp.data ?? []) {
    const cur = callsByTenant.get(a.tenant_id ?? "?") ?? { total: 0, errors: 0 }
    cur.total += 1
    if (a.action?.endsWith(".error")) cur.errors += 1
    callsByTenant.set(a.tenant_id ?? "?", cur)
  }

  const kpis = computeKpis({
    activeTenants: active.count ?? 0,
    provisioningDurationsSec: durations,
    tenant5xxLastHour: [],
    mcpCallsLastHour: [...callsByTenant].map(([tenant_id, v]) => ({ tenant_id, ...v })),
    healthStreaks,
  })

  const cards: [string, string | number, boolean][] = [
    ["Active tenants", kpis.tenant_count_active, false],
    ["Provisioning p95 (30d)", `${Math.round(kpis.provisioning_p95_seconds)}s`, false],
    ["MCP calls (1h)", kpis.mcp_tool_call_count_last_hour, false],
    ["MCP error rate (1h)", `${(kpis.mcp_tool_call_error_rate * 100).toFixed(1)}%`,
      kpis.mcp_tool_call_error_rate > 0.1],
    ["Max health-fail streak", kpis.max_health_failure_streak,
      kpis.max_health_failure_streak >= 3],
  ]

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>
      <div className="grid grid-cols-3 gap-4">
        {cards.map(([label, value, danger]) => (
          <div key={label} className="border rounded p-4">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className={`text-2xl font-semibold ${danger ? "text-red-600" : "text-foreground"}`}>
              {value}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
