import type { SupabaseClient } from "@supabase/supabase-js"
import type { JobStatus, ProvisioningJob, ProvisioningStep } from "../types"

export async function claimQueuedJob(c: SupabaseClient): Promise<ProvisioningJob | null> {
  // Atomically claim a queued job by updating status to 'running'.
  const { data, error } = await c.rpc("claim_queued_job")
  if (error) throw error
  return (data as ProvisioningJob | null) ?? null
}

export async function listJobsForTenant(c: SupabaseClient, tenantId: string): Promise<ProvisioningJob[]> {
  const { data, error } = await c.from("provisioning_jobs").select("*")
    .eq("tenant_id", tenantId).order("created_at")
  if (error) throw error
  return (data ?? []) as ProvisioningJob[]
}

export async function markJobStatus(
  c: SupabaseClient,
  id: string,
  status: JobStatus,
  patch: { last_error?: string; result?: unknown } = {},
) {
  const update: Record<string, unknown> = { status }
  if (status === "success" || status === "failed") update.finished_at = new Date().toISOString()
  if (patch.last_error !== undefined) update.last_error = patch.last_error
  if (patch.result !== undefined) update.result = patch.result
  const { error } = await c.from("provisioning_jobs").update(update).eq("id", id)
  if (error) throw error
}

export async function enqueueJobs(
  c: SupabaseClient,
  tenantId: string,
  steps: ProvisioningStep[],
) {
  const rows = steps.map(step => ({ tenant_id: tenantId, step, status: "queued" as JobStatus }))
  const { error } = await c.from("provisioning_jobs").insert(rows)
  if (error) throw error
}
