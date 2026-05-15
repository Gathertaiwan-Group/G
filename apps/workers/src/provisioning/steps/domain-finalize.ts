import {
  setVercelEnv, triggerVercelDeploy, pollVercelReady, addVercelDomain,
} from "@realreal/provisioning/clients/vercel"
import { pollRailwayHealthz } from "@realreal/provisioning/clients/railway"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const domainFinalizeHandler: StepHandler = {
  step: "domain_finalize",
  async isComplete() {
    return false // idempotent reconcile every run
  },
  async run(ctx) {
    const token = process.env.VERCEL_TOKEN
    if (!token) throw new Error("VERCEL_TOKEN not set")
    const i = ctx.infra as
      | { vercel_project_id?: string; railway_api_url?: string; railway_mcp_url?: string }
      | null
    if (!i?.vercel_project_id || !i.railway_api_url || !i.railway_mcp_url) {
      throw new Error("vercel_setup + railway_setup must complete before domain_finalize")
    }
    // 1. wait for Railway services healthy
    await pollRailwayHealthz(`${i.railway_api_url}/health`, { intervalMs: 5_000, maxMs: 300_000 })
    await pollRailwayHealthz(`${i.railway_mcp_url}/healthz`, { intervalMs: 5_000, maxMs: 300_000 })
    // 2. overwrite the placeholder API URL with the real Railway URL, redeploy
    await setVercelEnv(token, i.vercel_project_id, { NEXT_PUBLIC_API_URL: i.railway_api_url })
    const dpl = await triggerVercelDeploy(token, i.vercel_project_id)
    await pollVercelReady(token, dpl, { intervalMs: 5_000, maxMs: 180_000 })
    // 3. attach the public domain (platform subdomain; BYO added but unverified
    //    until the manual confirm gate in v1)
    const domain = ctx.tenant.custom_domain ?? ctx.platformDomain
    await addVercelDomain(token, i.vercel_project_id, domain)
  },
}
registerHandler(domainFinalizeHandler)
