// scripts/provision-throwaway.ts
//
// Manual L3 harness (spec §10) for Phase D D3 / D5:
//   D3 = spin up a throwaway `pioneer-test-*` tenant against real TEST-mode infra.
//   D5 = prove 3 consecutive successful live provisions.
//
// It does NOT call Stripe or any Mgmt API directly. Instead it does exactly
// what the merged Stripe `checkout.session.completed` webhook does
// (apps/workers/src/webhooks/stripe.ts): insert a `tenants` row and enqueue
// the 8 provisioning_jobs. The already-running `apps/workers` process then
// drains the queue through the real, merged step handlers + dispatcher. This
// script only seeds + polls; it never mutates production pipeline logic.
//
// SAFETY: hard-gated behind ALLOW_LIVE_PROVISION=yes so it can never run in
// CI or by accident. The unit test (apps/workers/__tests__/provision-throwaway.test.ts)
// only imports `assertLiveAllowed` and never reaches the live code path.
//
// Run (a human, against TEST infra, after the USER-ACTIONABLE setup in
// docs/runbooks/stripe-webhook-pileup.md is done):
//   ALLOW_LIVE_PROVISION=yes npx tsx scripts/provision-throwaway.ts 3
import { createControlClient, tenants, jobs } from "@realreal/control-db"
import type { ProvisioningStep } from "@realreal/control-db"

const STEPS: ProvisioningStep[] = [
  "validate",
  "supabase_setup",
  "resend_setup",
  "cloudflare_dns",
  "vercel_setup",
  "railway_setup",
  "domain_finalize",
  "tenant_finalize",
]

export function assertLiveAllowed(): void {
  if (process.env.ALLOW_LIVE_PROVISION !== "yes") {
    throw new Error(
      "refusing: set ALLOW_LIVE_PROVISION=yes to run a live (test-mode) provision",
    )
  }
}

function requireOwnerId(): string {
  const id = process.env.PIONEER_OWNER_ID
  if (!id) {
    throw new Error(
      "PIONEER_OWNER_ID is required (the auth user id that will own the throwaway tenant)",
    )
  }
  return id
}

async function provisionOnce(slug: string): Promise<"active" | "failed"> {
  const c = createControlClient()
  // Mirror the merged Stripe webhook: create tenant + enqueue the same 8 steps.
  const id = await tenants.createTenant(c, {
    slug,
    custom_domain: null,
    owner_user_id: requireOwnerId(),
    plan: "standard",
  })
  await jobs.enqueueJobs(c, id, STEPS)
  console.log(`  tenant ${id} created; 8 jobs enqueued — waiting for workers to drain`)

  // Poll the tenant row until terminal. The live workers process is what
  // actually advances the pipeline; this loop is read-only.
  const deadline = Date.now() + 12 * 60_000
  for (;;) {
    const t = await tenants.getTenant(c, id)
    if (t?.status === "active") return "active"
    if (t?.status === "failed") return "failed"
    if (Date.now() > deadline) {
      throw new Error(`timeout: tenant ${slug} (${id}) not terminal in 12m`)
    }
    await new Promise(r => setTimeout(r, 10_000))
  }
}

async function main() {
  assertLiveAllowed()
  const runs = Number(process.argv[2] ?? 1) // D5: pass 3
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`invalid run count "${process.argv[2]}" — pass a positive integer`)
  }
  for (let i = 1; i <= runs; i++) {
    const slug = `pioneer-test-${Date.now().toString(36)}-${i}`
    console.log(`▶ provision ${i}/${runs}: ${slug}`)
    const result = await provisionOnce(slug)
    console.log(`  → ${result}`)
    if (result !== "active") {
      console.error(
        `✗ run ${i} ended '${result}'. Inspect /jobs for the tenant; ` +
          `replay the failed step per docs/runbooks/stripe-webhook-pileup.md.`,
      )
      process.exit(1)
    }
  }
  console.log(`✓ ${runs} consecutive successful live provisions`)
  console.log(
    "Reminder: tear down the throwaway tenants (Supabase project, Vercel " +
      "project, Railway services, Resend domain, Cloudflare CNAME) — see the " +
      "runbook 'Teardown' section.",
  )
}

if (require.main === module) {
  main().catch(e => {
    console.error(e)
    process.exit(1)
  })
}
