import { upsertCnameRecord } from "@realreal/provisioning/clients/cloudflare"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const cloudflareDnsHandler: StepHandler = {
  step: "cloudflare_dns",
  async isComplete() {
    // upsertCnameRecord is itself idempotent (GET then POST/PATCH); always
    // safe to re-run, so report incomplete and let run() reconcile.
    return false
  },
  async run(ctx) {
    if (ctx.tenant.custom_domain) {
      // BYO: customer sets their own DNS; records are included in the
      // welcome email (tenant_finalize). v1 has a manual confirm gate.
      return
    }
    const token = process.env.CLOUDFLARE_API_TOKEN
    const zoneId = process.env.CLOUDFLARE_PLATFORM_ZONE_ID
    if (!token || !zoneId) throw new Error("CLOUDFLARE_API_TOKEN / CLOUDFLARE_PLATFORM_ZONE_ID not set")
    await upsertCnameRecord({
      token, zoneId, name: ctx.platformDomain, content: "cname.vercel-dns.com",
    })
  },
}
registerHandler(cloudflareDnsHandler)
