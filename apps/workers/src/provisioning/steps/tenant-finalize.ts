import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { infrastructure, tenants } from "@realreal/control-db"
import { runTenantSql } from "@realreal/provisioning/clients/supabase-mgmt"
import { sendWelcomeEmail } from "../notify"
import { registerHandler } from "./registry"
import type { StepHandler } from "./types"

export const tenantFinalizeHandler: StepHandler = {
  step: "tenant_finalize",
  async isComplete(ctx) {
    return ctx.tenant.status === "active"
  },
  async run(ctx) {
    const pat = process.env.SUPABASE_PAT
    const ownerEmail = process.env.OWNER_ADMIN_EMAIL
    if (!pat) throw new Error("SUPABASE_PAT not set")
    if (!ownerEmail) throw new Error("OWNER_ADMIN_EMAIL not set")
    const ref = ctx.infra?.supabase_project_ref
    if (!ref) throw new Error("supabase_setup must complete before tenant_finalize")

    // 1. MCP token: plaintext emailed once, only bcrypt hash persisted
    const mcpToken = randomBytes(32).toString("hex")
    const mcpHash = await bcrypt.hash(mcpToken, 10)
    await infrastructure.upsertInfrastructure(ctx.client, ctx.tenant.id,
      { mcp_token_hash: mcpHash }, ctx.kek)

    // 2. virtual admin user mcp@<slug>.local + role=admin (idempotent upsert).
    //    spec §8 — MCP server signs in as this user against apps/api.
    const mcpEmail = `mcp@${ctx.tenant.slug}.local`
    await runTenantSql(pat, ref, `
insert into auth.users (id, email, role, raw_app_meta_data, email_confirmed_at)
values (gen_random_uuid(), '${mcpEmail}', 'authenticated',
        '{"role":"admin"}'::jsonb, now())
on conflict (email) do nothing;`, "create mcp admin user")

    // 3. welcome email (site URL, MCP endpoint, plaintext token once)
    const siteUrl = ctx.tenant.custom_domain
      ? `https://${ctx.tenant.custom_domain}` : `https://${ctx.platformDomain}`
    await sendWelcomeEmail({
      to: ownerEmail, slug: ctx.tenant.slug, siteUrl,
      mcpUrl: ctx.infra?.railway_mcp_url ?? "(pending)", mcpToken,
    })

    // 4. activate
    await tenants.updateTenantStatus(ctx.client, ctx.tenant.id, "active")
  },
}
registerHandler(tenantFinalizeHandler)
