import pino from "pino"
import cron from "node-cron"
import { createControlClient, tenants } from "@realreal/control-db"

const log = pino({ name: "cron-health-check" })

// Skeleton: in Phase A we just enumerate active tenants and log. Phase B/C
// will pull each tenant's vercel/api/mcp/supabase endpoints out of the
// control DB and probe them with `AbortSignal.timeout`, then write rows into
// `tenant_health_log` via control-db `health.recordHealth`.
export async function runHealthCheckOnce(): Promise<void> {
  try {
    const client = createControlClient()
    const list = await tenants.listActiveTenants(client).catch(() => [])
    log.info({ activeTenantCount: list.length }, "health-check skeleton (no probes yet)")
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "health-check tick failed")
  }
}

export function scheduleHealthCheck(): cron.ScheduledTask {
  const task = cron.schedule("*/5 * * * *", () => {
    void runHealthCheckOnce()
  })
  log.info("scheduled health-check every 5 minutes")
  return task
}
