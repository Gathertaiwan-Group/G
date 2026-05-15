// scripts/create-canary-tenant.ts
//
// One-time, idempotent: registers the platform-owned `staging-canary` tenant
// and enqueues the standard 8-step provisioning pipeline for it (spec §7).
// The already-running apps/workers process then drains the queue through the
// merged step handlers, exactly as a paying tenant would. All modules are
// enabled and synthetic data is seeded by the canary's own admin
// post-provision (spec §7) — out of scope for this script.
//
// Re-running is safe: if `staging-canary` already exists it is a no-op.
//
// USER-ACTIONABLE — run once by a human with PLATFORM_OWNER_ID +
// CONTROL_DB_URL + CONTROL_DB_SERVICE_ROLE_KEY in the environment:
//   PLATFORM_OWNER_ID=<uuid> npx tsx scripts/create-canary-tenant.ts
import { createControlClient, tenants, jobs } from "@realreal/control-db"

async function main() {
  const c = createControlClient()
  const existing = await tenants.getTenantBySlug(c, "staging-canary")
  if (existing) {
    console.log("staging-canary already exists; nothing to do")
    return
  }
  const id = await tenants.createTenant(c, {
    slug: "staging-canary",
    custom_domain: null,
    owner_user_id: process.env.PLATFORM_OWNER_ID!,
    plan: "pro",
  })
  await jobs.enqueueJobs(c, id, [
    "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
    "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
  ])
  console.log(`✓ enqueued provisioning for staging-canary (${id})`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
