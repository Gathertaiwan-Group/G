// scripts/fanout-deploy.ts
//
// Production-branch deploy fan-out (Phase D6 / spec §7 "promote" job).
//
// Enumerates every `active` tenant in the control DB and triggers a fresh
// production deploy of each tenant's Vercel project + both Railway services
// (api, mcp) via the merged Mgmt-API client wrappers in
// infrastructure/provisioning/clients. Each tenant is isolated in its own
// try/catch: a single tenant's failure is recorded to `audit_log` and the
// loop continues — siblings MUST still deploy (spec §7). Partial failure is
// surfaced to CI via a non-zero exit code so the GitHub Actions `promote`
// job goes red without having aborted the rest of the fleet.
//
// Optional `--only=<slug>` arg (used by the canary job in
// .github/workflows/deploy-production-fanout.yml) filters the active-tenant
// list down to a single slug so the canary is deployed + smoke-tested before
// the full promote fan-out runs.
import { createControlClient, tenants, infrastructure, audit } from "@realreal/control-db"
import { triggerVercelDeploy } from "@realreal/provisioning/clients/vercel"
import { deployRailwayService } from "@realreal/provisioning/clients/railway"

export async function fanoutDeploy(
  only?: string,
): Promise<{ ok: string[]; failed: string[] }> {
  const c = createControlClient()
  const vToken = process.env.VERCEL_TOKEN!
  const rToken = process.env.RAILWAY_TOKEN!
  const all = await tenants.listActiveTenants(c)
  const active = only ? all.filter(t => t.slug === only) : all
  const ok: string[] = []
  const failed: string[] = []
  for (const t of active) {
    try {
      const i = await infrastructure.getInfrastructure(c, t.id)
      if (!i) throw new Error("no infrastructure row")
      if (i.vercel_project_id) await triggerVercelDeploy(vToken, i.vercel_project_id)
      if (i.railway_api_service_id) await deployRailwayService(rToken, i.railway_api_service_id)
      if (i.railway_mcp_service_id) await deployRailwayService(rToken, i.railway_mcp_service_id)
      ok.push(t.slug)
      await audit.emitAudit(c, {
        tenant_id: t.id, actor_type: "system", actor_id: "fanout",
        action: "fanout_deploy_ok", resource: null, payload: null,
      })
    } catch (e) {
      failed.push(t.slug)
      await audit.emitAudit(c, {
        tenant_id: t.id, actor_type: "system", actor_id: "fanout",
        action: "fanout_deploy_failed", resource: null,
        payload: { error: e instanceof Error ? e.message : String(e) },
      })
      // do NOT rethrow — siblings must still deploy (spec §7 promote job)
    }
  }
  return { ok, failed }
}

// Parse `--only=<slug>` from argv (used by the canary CI job).
function parseOnly(argv: string[]): string | undefined {
  const flag = argv.find(a => a.startsWith("--only="))
  return flag ? flag.slice("--only=".length) : undefined
}

if (require.main === module) {
  fanoutDeploy(parseOnly(process.argv.slice(2)))
    .then(s => {
      console.log(JSON.stringify(s))
      if (s.failed.length) process.exitCode = 1 // surface partial failure to CI
    })
    .catch(e => {
      console.error(e)
      process.exit(1)
    })
}
