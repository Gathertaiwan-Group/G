import { infrastructure } from "@realreal/control-db"
import {
  createRailwayProject, createRailwayService, setRailwayVars,
  deployRailwayService, getRailwayEnvironmentId, createRailwayServiceDomain,
} from "@realreal/provisioning/clients/railway"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const railwaySetupHandler: StepHandler = {
  step: "railway_setup",
  async isComplete(ctx) {
    // Must reflect URLs too: domain_finalize hard-requires
    // railway_api_url/railway_mcp_url, so a partial run that persisted only
    // the service ids must re-run to create+persist the public domains.
    return Boolean(
      ctx.infra?.railway_api_service_id && ctx.infra?.railway_mcp_service_id &&
      ctx.infra?.railway_api_url && ctx.infra?.railway_mcp_url,
    )
  },
  async run(ctx) {
    const token = process.env.RAILWAY_TOKEN
    const internalSecret = process.env.INTERNAL_API_SECRET
    if (!token) throw new Error("RAILWAY_TOKEN not set")
    if (!internalSecret) throw new Error("INTERNAL_API_SECRET not set")
    if (!ctx.infra?.supabase_url || !ctx.infra?.supabase_anon_key) {
      throw new Error("supabase_setup must complete before railway_setup")
    }
    const projectId = await createRailwayProject(token, `tenant-${ctx.tenant.slug}`)
    const environmentId = await getRailwayEnvironmentId(token, projectId)
    const sharedEnv = {
      SUPABASE_URL: ctx.infra.supabase_url,
      SUPABASE_ANON_KEY: ctx.infra.supabase_anon_key,
      INTERNAL_API_SECRET: internalSecret,
    }
    const apiSvc = await createRailwayService(token, projectId, "api",
      "Gathertaiwan-Group/G", "production", "apps/api")
    await setRailwayVars(token, apiSvc, sharedEnv)
    await deployRailwayService(token, apiSvc)
    const apiDomain = await createRailwayServiceDomain(token, environmentId, apiSvc)

    const mcpSvc = await createRailwayService(token, projectId, "mcp",
      "Gathertaiwan-Group/G", "production", "apps/mcp")
    await setRailwayVars(token, mcpSvc, sharedEnv)
    await deployRailwayService(token, mcpSvc)
    const mcpDomain = await createRailwayServiceDomain(token, environmentId, mcpSvc)

    // Persist service ids AND the public URLs in the same patch so
    // domain_finalize's ordering guard can pass and poll /health + /healthz.
    await infrastructure.upsertInfrastructure(ctx.client, ctx.tenant.id, {
      railway_project_id: projectId,
      railway_api_service_id: apiSvc,
      railway_api_url: `https://${apiDomain}`,
      railway_mcp_service_id: mcpSvc,
      railway_mcp_url: `https://${mcpDomain}`,
    }, ctx.kek)
  },
}
registerHandler(railwaySetupHandler)
