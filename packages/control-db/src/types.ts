export type TenantStatus =
  | "pending_payment"
  | "provisioning"
  | "active"
  | "suspended"
  | "canceled"
  | "failed"

export type ActorType = "platform_admin" | "customer_agent" | "system" | "customer_user"

export type ProvisioningStep =
  | "validate"
  | "supabase_setup"
  | "resend_setup"
  | "cloudflare_dns"
  | "vercel_setup"
  | "railway_setup"
  | "domain_finalize"
  | "tenant_finalize"

export type JobStatus = "queued" | "running" | "success" | "failed"

export interface Tenant {
  id: string
  slug: string
  custom_domain: string | null
  status: TenantStatus
  owner_user_id: string
  plan: string | null
  created_at: string
  activated_at: string | null
}

export interface ProvisioningJob {
  id: string
  tenant_id: string
  step: ProvisioningStep
  status: JobStatus
  attempt: number
  last_error: string | null
  payload: unknown
  result: unknown
  created_at: string
  finished_at: string | null
}

export interface AuditEntry {
  tenant_id: string | null
  actor_type: ActorType
  actor_id: string | null
  action: string
  resource: string | null
  payload: unknown
}

export interface TenantInfrastructure {
  tenant_id: string
  vercel_deployment_url: string | null
  railway_api_url: string | null
  railway_mcp_url: string | null
  supabase_url: string
  supabase_anon_key: string
}

export interface HealthRow {
  tenant_id: string
  checked_at: string
  vercel_ok: boolean
  api_ok: boolean
  mcp_ok: boolean
  supabase_ok: boolean
  details: unknown
}
