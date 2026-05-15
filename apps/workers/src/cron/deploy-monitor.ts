import pino from "pino"
import { alertOps } from "../provisioning/notify"

const log = pino({ name: "deploy-monitor" })

export interface MonitorTick {
  tenantId: string
  recent: boolean[]
}
export interface MonitorDecision {
  shouldRollback: boolean
}

// Pure decision: roll back when the 3 most-recent health checks ALL failed
// (spec §7 "on 3 consecutive failures for a tenant"). `recent` is newest-first
// (matches @realreal/control-db `recentHealth`, which orders checked_at desc).
//
// Idempotence / no rollback-loop: the decision keys ONLY on the 3 newest
// samples. The very first post-rollback health tick that comes back green
// puts a `true` at the head of `recent`, which breaks the 3-streak — so once
// a rollback has been triggered and the service recovers, the monitor will
// NOT fire a second rollback for the same regression. If the rollback did not
// fix it the next pass legitimately re-fires (still broken), but each pass
// performs at most one rollback attempt per tenant and the CI watch is
// time-boxed (12 passes / ~1h), so it cannot loop unbounded.
export function evaluateMonitorTick(t: MonitorTick): MonitorDecision {
  const last3 = t.recent.slice(0, 3)
  return {
    shouldRollback: last3.length === 3 && last3.every((ok) => ok === false),
  }
}

// Wired by the workflow `monitor` job: for ~1 hour, every 5 min, read the most
// recent tenant_health_log rows per active tenant, and on a 3-streak invoke
// scripts/rollback-tenant.ts + alert. (Reuses the Phase-A health-check cron's
// recorded data; does NOT re-implement probing.) Each tenant is isolated:
// a rollback failure for one tenant alerts and continues to the next.
export async function runMonitorPass(deps: {
  listActiveTenantsWithInfra: () => Promise<
    {
      tenantId: string
      slug: string
      recent: boolean[]
      vercelProjectId: string
      railwayApiServiceId: string
    }[]
  >
  rollback: (a: {
    vercelProjectId: string
    railwayApiServiceId: string
  }) => Promise<void>
}): Promise<void> {
  const tenants = await deps.listActiveTenantsWithInfra()
  for (const t of tenants) {
    const { shouldRollback } = evaluateMonitorTick({
      tenantId: t.tenantId,
      recent: t.recent,
    })
    if (!shouldRollback) continue
    log.error({ tenant: t.slug }, "3-streak health failure — auto-rolling back")
    try {
      await deps.rollback({
        vercelProjectId: t.vercelProjectId,
        railwayApiServiceId: t.railwayApiServiceId,
      })
      await alertOps(
        `Auto-rollback executed for ${t.slug}`,
        `3 consecutive post-deploy health failures. Vercel rolled back + Railway redeployed. Investigate per docs/runbooks/code-deploy-broke-everyone.md.`,
      )
    } catch (e) {
      await alertOps(
        `Auto-rollback FAILED for ${t.slug}`,
        `Manual intervention required: ${String(e)}. Follow docs/runbooks/code-deploy-broke-everyone.md.`,
      )
    }
  }
}
