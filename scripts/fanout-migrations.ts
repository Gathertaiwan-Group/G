// scripts/fanout-migrations.ts
//
// Production-branch migration fan-out (Phase D6 / spec §7 "migrations" job).
//
// Iterates every `active` tenant in the control DB and applies the platform's
// pending DB migrations to that tenant's Supabase project by REUSING the
// merged, idempotent infrastructure/provisioning/apply-tenant-migrations.ts
// (which diffs packages/db/migrations vs the tenant's `schema_migrations`
// table). That script is parameterised purely by the `TENANT_DB_REF` /
// `SUPABASE_PAT` environment variables and self-exits, so we invoke it once
// per tenant as a child process with `TENANT_DB_REF` bound to that tenant's
// `supabase_project_ref` — no edits to the merged migration logic.
//
// Per spec §7, migrations are the one fan-out job that MUST abort on the
// first failure: a half-migrated fleet is worse than a blocked promote. We
// therefore rethrow on any tenant's non-zero exit (process exits 1), unlike
// fanout-deploy.ts which isolates per-tenant failures.
//
// USER-ACTIONABLE — invoked by the `migrations` job in
// .github/workflows/deploy-production-fanout.yml with SUPABASE_PAT,
// CONTROL_DB_URL, CONTROL_DB_SERVICE_ROLE_KEY in the environment.
import { spawn } from "node:child_process"
import { join } from "node:path"
import { createControlClient, tenants, infrastructure } from "@realreal/control-db"

const APPLY_SCRIPT = join(
  __dirname, "..", "infrastructure", "provisioning", "apply-tenant-migrations.ts",
)

function applyForRef(ref: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [require.resolve("tsx/cli"), APPLY_SCRIPT],
      {
        stdio: "inherit",
        env: { ...process.env, TENANT_DB_REF: ref },
      },
    )
    child.on("error", reject)
    child.on("exit", code =>
      code === 0
        ? resolve()
        : reject(new Error(`apply-tenant-migrations exited ${code} for ref ${ref}`)),
    )
  })
}

export async function fanoutMigrations(): Promise<{ migrated: string[] }> {
  const c = createControlClient()
  const active = await tenants.listActiveTenants(c)
  const migrated: string[] = []
  for (const t of active) {
    const i = await infrastructure.getInfrastructure(c, t.id)
    const ref = i?.supabase_project_ref
    if (!ref) {
      // No Supabase project ref means the tenant is not fully provisioned;
      // aborting the whole fan-out (spec §7) rather than silently skipping.
      throw new Error(`tenant ${t.slug} (${t.id}) has no supabase_project_ref`)
    }
    await applyForRef(ref)
    migrated.push(t.slug)
  }
  return { migrated }
}

if (require.main === module) {
  fanoutMigrations()
    .then(s => console.log(JSON.stringify(s)))
    .catch(e => {
      console.error(e)
      process.exit(1) // abort the whole job on any migration error (spec §7)
    })
}
