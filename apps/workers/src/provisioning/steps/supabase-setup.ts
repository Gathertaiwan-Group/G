import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { infrastructure } from "@realreal/control-db"
import {
  createSupabaseProject, pollProjectHealthy, fetchProjectApiKeys,
  runTenantSql, configureAuth, createStorageBuckets,
} from "@realreal/provisioning/clients/supabase-mgmt"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

function requireEnv(n: string): string {
  const v = process.env[n]
  if (!v) throw new Error(`${n} not set`)
  return v
}

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..",
  "packages", "db", "migrations")

export const supabaseSetupHandler: StepHandler = {
  step: "supabase_setup",
  async isComplete(ctx) {
    return Boolean(ctx.infra?.supabase_project_ref)
  },
  async run(ctx) {
    const pat = requireEnv("SUPABASE_PAT")
    const orgId = requireEnv("SUPABASE_ORG_ID")
    // 1. create (or reuse if a partial run left a ref — caller re-loads ctx)
    const { ref, url } = await createSupabaseProject({
      pat, name: `tenant-${ctx.tenant.slug}`, region: "ap-northeast-1",
      orgId, dbPass: requireEnv("PLATFORM_KEK").slice(0, 24),
    })
    await pollProjectHealthy(pat, ref, { intervalMs: 5_000, maxMs: 180_000 })
    const { anon, serviceRole } = await fetchProjectApiKeys(pat, ref)

    // 2. run every tenant migration in order (idempotent: 0015 bootstraps
    //    schema_migrations; see infrastructure/provisioning/apply-tenant-migrations.ts)
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort()
    for (const f of files) {
      await runTenantSql(pat, ref, readFileSync(join(MIGRATIONS_DIR, f), "utf8"), `migrate ${f}`)
    }

    // 3. seed (spec §5): brand + module_config defaults are seeded by
    //    migration 0020_brand_seed.sql which the loop above already ran.
    //    Categories root + default plans/tiers/campaign templates are also
    //    in 0020. No extra seed SQL needed here.

    // 4. Auth config
    const siteUrl = ctx.tenant.custom_domain
      ? `https://${ctx.tenant.custom_domain}`
      : `https://${ctx.platformDomain}`
    await configureAuth(pat, ref, siteUrl, [
      `${siteUrl}/auth/callback`, "https://*.vercel.app/auth/callback",
    ])

    // 5. storage buckets
    await createStorageBuckets(pat, ref)

    // 6. persist infra (service_role key KEK-encrypted in upsertInfrastructure)
    await infrastructure.upsertInfrastructure(ctx.client, ctx.tenant.id, {
      supabase_project_ref: ref,
      supabase_url: url,
      supabase_anon_key: anon,
      supabase_service_role_key: serviceRole,
    }, ctx.kek)
  },
}
registerHandler(supabaseSetupHandler)
