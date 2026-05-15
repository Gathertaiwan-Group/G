import { infrastructure } from "@realreal/control-db"
import {
  createVercelProject, setVercelEnv, triggerVercelDeploy, pollVercelReady,
} from "@realreal/provisioning/clients/vercel"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const vercelSetupHandler: StepHandler = {
  step: "vercel_setup",
  async isComplete(ctx) {
    return Boolean(ctx.infra?.vercel_project_id)
  },
  async run(ctx) {
    const token = process.env.VERCEL_TOKEN
    if (!token) throw new Error("VERCEL_TOKEN not set")
    if (!ctx.infra?.supabase_url || !ctx.infra?.supabase_anon_key) {
      throw new Error("supabase_setup must complete before vercel_setup")
    }
    const projectId = await createVercelProject({
      token, name: `tenant-${ctx.tenant.slug}`,
      repo: "Gathertaiwan-Group/G", branch: "production", rootDir: "apps/web",
    })
    await setVercelEnv(token, projectId, {
      NEXT_PUBLIC_SUPABASE_URL: ctx.infra.supabase_url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ctx.infra.supabase_anon_key,
      // Real Railway API URL is unknown until railway_setup; placeholder now,
      // overwritten in domain_finalize.
      NEXT_PUBLIC_API_URL: "https://placeholder.invalid",
    })
    const deploymentId = await triggerVercelDeploy(token, projectId)
    const deployUrl = await pollVercelReady(token, deploymentId,
      { intervalMs: 5_000, maxMs: 180_000 })
    await infrastructure.upsertInfrastructure(ctx.client, ctx.tenant.id, {
      vercel_project_id: projectId, vercel_deployment_url: deployUrl,
    }, ctx.kek)
  },
}
registerHandler(vercelSetupHandler)
