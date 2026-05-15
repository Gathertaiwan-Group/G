import { tenants } from "@realreal/control-db"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

const SLUG_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/
const RESERVED = new Set(["platform", "www", "api", "mcp", "admin", "canary", "staging"])

export const validateHandler: StepHandler = {
  step: "validate",
  async isComplete(ctx) {
    return ctx.tenant.status === "provisioning" || ctx.tenant.status === "active"
  },
  async run(ctx) {
    const { slug, custom_domain, plan } = ctx.tenant
    if (!SLUG_RE.test(slug)) throw new Error(`invalid slug '${slug}'`)
    if (RESERVED.has(slug)) throw new Error(`reserved slug '${slug}'`)
    if (custom_domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(custom_domain)) {
      throw new Error(`invalid custom_domain '${custom_domain}'`)
    }
    if (plan && !["starter", "standard", "pro"].includes(plan)) {
      throw new Error(`invalid plan '${plan}'`)
    }
    await tenants.updateTenantStatus(ctx.client, ctx.tenant.id, "provisioning")
  },
}
registerHandler(validateHandler)
