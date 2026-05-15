"use server"
import { revalidatePath } from "next/cache"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { jobs, audit } from "@realreal/control-db"

// Spec §6 "Retry from this step". State-mutating admin action:
//  1. authn/authz gate (requirePlatformUser) FIRST — same guard every control
//     mutation uses; redirects unauthenticated/non-platform users.
//  2. idempotent + safe: only a job currently in `failed` is retryable; the
//     tenant is only un-stuck when it is in `failed` (the .eq("status",
//     "failed") makes resuming a healthy/provisioning tenant a no-op).
//  3. writes an audit_log entry (actor = platform admin).
export async function retryProvisioningStep(formData: FormData): Promise<void> {
  const user = await requirePlatformUser()        // guard FIRST
  const tenantId = String(formData.get("tenantId") ?? "")
  const step = String(formData.get("step") ?? "")
  if (!tenantId || !step) throw new Error("tenantId and step required")

  const supabase = await createControlClient()

  // Idempotency / valid-transition guard: only retry a job that actually
  // failed. Retrying a queued/running/succeeded step would corrupt pipeline
  // state, so reject it instead of blindly re-queuing.
  const { data: job, error: jobErr } = await supabase
    .from("provisioning_jobs")
    .select("status")
    .eq("tenant_id", tenantId).eq("step", step)
    .maybeSingle()
  if (jobErr) throw new Error(`load job: ${jobErr.message}`)
  if (!job) throw new Error(`no ${step} job for tenant ${tenantId}`)
  if (job.status !== "failed") {
    throw new Error(`step ${step} is ${job.status}, only failed steps are retryable`)
  }

  await jobs.requeueStep(supabase, tenantId, step)
  // also un-stick the tenant row so the running pipeline can finish — scoped
  // to status=failed so it is a no-op for any other tenant state.
  await supabase.from("tenants").update({ status: "provisioning" })
    .eq("id", tenantId).eq("status", "failed")

  await audit.emitAudit(supabase, {
    tenant_id: tenantId,
    actor_type: "platform_admin",
    actor_id: user.id,
    action: "provisioning.retry_step",
    resource: `tenant:${tenantId}`,
    payload: { step },
  })

  revalidatePath(`/tenants/${tenantId}/provision`)
}
