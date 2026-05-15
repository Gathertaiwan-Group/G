import { infrastructure } from "@realreal/control-db"
import { addResendDomain } from "@realreal/provisioning/clients/resend"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const resendSetupHandler: StepHandler = {
  step: "resend_setup",
  async isComplete(ctx) {
    // Platform-subdomain tenants share mail.platform.realreal.cc (verified
    // once at platform setup). Nothing per-tenant to do (spec §6 step 3).
    if (!ctx.tenant.custom_domain) return true
    return Boolean(ctx.infra?.resend_domain_id)
  },
  async run(ctx) {
    if (!ctx.tenant.custom_domain) return
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error("RESEND_API_KEY not set")
    const { id } = await addResendDomain(apiKey, `mail.${ctx.tenant.custom_domain}`)
    await infrastructure.upsertInfrastructure(ctx.client, ctx.tenant.id,
      { resend_domain_id: id }, ctx.kek)
    // DKIM TXT records are emailed to the customer in tenant_finalize; the
    // hourly cron (resend-dkim-verify.ts) polls verification post-provision.
  },
}
registerHandler(resendSetupHandler)
