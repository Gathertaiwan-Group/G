// scripts/rollback-tenant.ts
//
// Roll a single tenant back to its previous good deploy. Used by the spec §7
// deploy `monitor` job (auto, on a 3-consecutive-failure streak) and manually
// from docs/runbooks/code-deploy-broke-everyone.md.
//
// Plan note (PR-E4 Step 3): Phase D already shipped Mgmt-API client wrappers
// with a Vercel rollback helper (`rollbackVercel`, promotes the previous READY
// production deployment) and a Railway redeploy helper (`deployRailwayService`,
// `serviceInstanceRedeploy`). We REUSE those — the inline `fetch` in the plan
// sketch is intentionally dropped in favour of the merged, unit-tested
// transport (the PR-E4 test pins behaviour, not the wire shape). No client
// change was required: both helpers exist and the provisioning suite stays
// green (26 tests).
import { rollbackVercel } from "@realreal/provisioning/clients/vercel"
import { deployRailwayService } from "@realreal/provisioning/clients/railway"

export interface RollbackArgs {
  vercelProjectId: string
  railwayApiServiceId: string
  vercelToken: string
  railwayToken: string
}

// Ordering matters: promote the previous Vercel production deployment FIRST
// and let it throw before we touch Railway, so a Vercel-side failure fails
// loud (non-zero) and we never half-roll-back. `rollbackVercel` already
// throws on a non-2xx Mgmt-API response and when there is no previous READY
// deployment to promote, so the monitor's caller can rely on a thrown Error.
export async function rollbackTenant(a: RollbackArgs): Promise<void> {
  // 1. Vercel: promote the previous READY production deployment.
  await rollbackVercel(a.vercelToken, a.vercelProjectId)
  // 2. Railway: redeploy the previous successful deployment of the API
  //    service (serviceInstanceRedeploy re-runs the last good build).
  await deployRailwayService(a.railwayToken, a.railwayApiServiceId)
}

if (require.main === module) {
  const [vercelProjectId, railwayApiServiceId] = process.argv.slice(2)
  if (!vercelProjectId || !railwayApiServiceId) {
    console.error(
      "usage: tsx scripts/rollback-tenant.ts <vercelProjectId> <railwayApiServiceId>",
    )
    process.exit(2)
  }
  rollbackTenant({
    vercelProjectId,
    railwayApiServiceId,
    vercelToken: process.env.VERCEL_TOKEN!,
    railwayToken: process.env.RAILWAY_TOKEN!,
  })
    .then(() => console.log(JSON.stringify({ rolledBack: railwayApiServiceId })))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
