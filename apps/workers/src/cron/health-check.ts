import pino from "pino"
import cron from "node-cron"
import { createControlClient, tenants, health } from "@realreal/control-db"

const log = pino({ name: "cron-health-check" })

const PROBE_TIMEOUT_MS = 5000

interface ProbeResult {
  ok: boolean
  detail: unknown
}

// Resolve a single probe to ok/detail; never rejects. `okStatuses` decides
// what counts as healthy for a successfully completed request.
async function probe(
  url: string,
  okFor: (res: Response) => boolean,
  headers?: Record<string, string>,
): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      ...(headers ? { headers } : {}),
    })
    return { ok: okFor(res), detail: { status: res.status } }
  } catch (err) {
    return { ok: false, detail: { error: err instanceof Error ? err.message : String(err) } }
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path
}

async function probeTenant(
  client: ReturnType<typeof createControlClient>,
  tenantId: string,
): Promise<void> {
  const infra = await tenants.getTenantInfrastructure(client, tenantId)
  if (!infra) {
    log.warn({ tenantId }, "no tenant_infrastructure row; skipping probes")
    await health.recordHealth(client, {
      tenant_id: tenantId,
      vercel_ok: false,
      api_ok: false,
      mcp_ok: false,
      supabase_ok: false,
      details: { error: "no tenant_infrastructure row" },
    })
    return
  }

  const details: Record<string, unknown> = {}

  const vercelP = infra.vercel_deployment_url
    ? probe(joinUrl(infra.vercel_deployment_url, "/"), (r) => r.status < 500)
    : Promise.resolve<ProbeResult>({ ok: false, detail: "no url" })
  const apiP = infra.railway_api_url
    ? probe(joinUrl(infra.railway_api_url, "/health"), (r) => r.ok)
    : Promise.resolve<ProbeResult>({ ok: false, detail: "no url" })
  const mcpP = infra.railway_mcp_url
    ? probe(joinUrl(infra.railway_mcp_url, "/health"), (r) => r.ok)
    : Promise.resolve<ProbeResult>({ ok: false, detail: "no url" })
  const supabaseAnon = infra.supabase_anon_key
  const supabaseP = infra.supabase_url
    ? supabaseAnon
      ? probe(
          joinUrl(infra.supabase_url, "/auth/v1/health"),
          (r) => r.ok,
          {
            apikey: supabaseAnon,
            Authorization: `Bearer ${supabaseAnon}`,
          },
        )
      : probe(joinUrl(infra.supabase_url, "/auth/v1/health"), (r) => r.ok).then(
          (r): ProbeResult => ({ ...r, detail: "no anon key" }),
        )
    : Promise.resolve<ProbeResult>({ ok: false, detail: "no url" })

  const [vercelR, apiR, mcpR, supabaseR] = await Promise.allSettled([
    vercelP,
    apiP,
    mcpP,
    supabaseP,
  ])

  const settle = (
    key: string,
    r: PromiseSettledResult<ProbeResult>,
  ): boolean => {
    if (r.status === "fulfilled") {
      details[key] = r.value.detail
      return r.value.ok
    }
    details[key] = {
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    }
    return false
  }

  const vercel_ok = settle("vercel", vercelR)
  const api_ok = settle("api", apiR)
  const mcp_ok = settle("mcp", mcpR)
  const supabase_ok = settle("supabase", supabaseR)

  await health.recordHealth(client, {
    tenant_id: tenantId,
    vercel_ok,
    api_ok,
    mcp_ok,
    supabase_ok,
    details,
  })
}

export async function runHealthCheckOnce(): Promise<void> {
  try {
    const client = createControlClient()
    const list = await tenants.listActiveTenants(client).catch((err) => {
      log.error(
        { err: err instanceof Error ? err.message : err },
        "listActiveTenants failed",
      )
      return []
    })
    log.info({ activeTenantCount: list.length }, "health-check tick start")

    for (const t of list) {
      try {
        await probeTenant(client, t.id)
      } catch (err) {
        log.error(
          { tenantId: t.id, err: err instanceof Error ? err.message : err },
          "health-check failed for tenant",
        )
      }
    }
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : err },
      "health-check tick failed",
    )
  }
}

export function scheduleHealthCheck(): cron.ScheduledTask {
  const task = cron.schedule("*/5 * * * *", () => {
    void runHealthCheckOnce()
  })
  log.info("scheduled health-check every 5 minutes")
  return task
}
