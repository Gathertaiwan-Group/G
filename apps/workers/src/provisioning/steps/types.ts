import type { SupabaseClient } from "@supabase/supabase-js"
import type { Tenant, TenantInfrastructure, ProvisioningStep } from "@realreal/control-db"

export interface TenantContext {
  client: SupabaseClient
  tenant: Tenant
  infra: TenantInfrastructure | null
  platformDomain: string          // `${slug}.platform.realreal.cc`
  kek: Buffer
}

export interface StepHandler {
  step: ProvisioningStep
  isComplete(ctx: TenantContext): Promise<boolean>
  run(ctx: TenantContext): Promise<void>
}

export const STEP_ORDER: ProvisioningStep[] = [
  "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
  "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
]
