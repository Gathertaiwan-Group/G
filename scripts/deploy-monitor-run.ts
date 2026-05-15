// scripts/deploy-monitor-run.ts
//
// Spec §7 deploy `monitor` entrypoint (deferred from Phase D, shipped in
// Phase E PR-E4). Invoked by the `monitor` job in
// .github/workflows/deploy-production-fanout.yml AFTER `promote`: watch the
// freshly fanned-out fleet for ~1 hour, polling every 5 minutes. On a
// 3-consecutive-health-failure streak for a tenant, auto-roll-back that
// tenant (Vercel previous READY deploy promote + Railway redeploy) and alert
// #platform-ops. Pure decision + rollback wiring live in
// apps/workers/src/cron/deploy-monitor.ts and scripts/rollback-tenant.ts;
// this file is the thin control-DB-reading glue (plan PR-E4 Step 9 note).
import { createControlClient, tenants, infrastructure, health } from "@realreal/control-db"
import { runMonitorPass } from "../apps/workers/src/cron/deploy-monitor"
import { rollbackTenant } from "./rollback-tenant"

const POLL_MS = 300_000 // 5 min
const PASSES = 12 // 12 * 5 min ≈ 1 hour (workflow timeout-minutes: 70)

async function buildDeps() {
  const c = createControlClient()
  const vToken = process.env.VERCEL_TOKEN!
  const rToken = process.env.RAILWAY_TOKEN!
  return {
    listActiveTenantsWithInfra: async () => {
      const active = await tenants.listActiveTenants(c)
      const rows: {
        tenantId: string
        slug: string
        recent: boolean[]
        vercelProjectId: string
        railwayApiServiceId: string
      }[] = []
      for (const t of active) {
        const infra = await infrastructure.getInfrastructure(c, t.id)
        // Only tenants whose deploy targets are both known can be rolled
        // back; skip the rest (they cannot have regressed via the fan-out).
        if (!infra?.vercel_project_id || !infra.railway_api_service_id) continue
        // Newest-first; take the 3 most-recent ticks (recentHealth orders
        // checked_at desc). A tick is "ok" only if every layer is ok.
        const recentRows = await health.recentHealth(c, t.id, 1)
        const recent = recentRows
          .slice(0, 3)
          .map((h) => h.vercel_ok && h.api_ok && h.mcp_ok && h.supabase_ok)
        rows.push({
          tenantId: t.id,
          slug: t.slug,
          recent,
          vercelProjectId: infra.vercel_project_id,
          railwayApiServiceId: infra.railway_api_service_id,
        })
      }
      return rows
    },
    rollback: (a: { vercelProjectId: string; railwayApiServiceId: string }) =>
      rollbackTenant({
        vercelProjectId: a.vercelProjectId,
        railwayApiServiceId: a.railwayApiServiceId,
        vercelToken: vToken,
        railwayToken: rToken,
      }),
  }
}

async function main() {
  const deps = await buildDeps()
  for (let i = 0; i < PASSES; i++) {
    await runMonitorPass(deps)
    if (i < PASSES - 1) {
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  }
}

if (require.main === module) {
  main()
    .then(() => console.log(JSON.stringify({ monitor: "complete", passes: PASSES })))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
