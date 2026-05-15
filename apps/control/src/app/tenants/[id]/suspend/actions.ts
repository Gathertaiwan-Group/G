"use server"
import { revalidatePath } from "next/cache"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { tenants, audit } from "@realreal/control-db"

// Spec §9 suspend/resume. State-mutating admin actions:
//  - requirePlatformUser() guard FIRST (same gate as every control mutation).
//  - valid-transition guard: only an active/non-suspended tenant can be
//    suspended; only a suspended tenant can be resumed. Re-running an action
//    against a tenant already in the target state is a no-op (idempotent),
//    not a corrupting double-write.
//  - audit_log entry written for every successful transition.

export async function suspendTenantAction(formData: FormData): Promise<void> {
  const user = await requirePlatformUser()
  const id = String(formData.get("tenantId") ?? "")
  if (!id) throw new Error("tenantId required")
  const reason = String(formData.get("reason") || "manual suspend (control plane)")

  const supabase = await createControlClient()
  const { data: t, error } = await supabase.from("tenants")
    .select("status").eq("id", id).maybeSingle()
  if (error) throw new Error(`load tenant: ${error.message}`)
  if (!t) throw new Error(`tenant ${id} not found`)
  if (t.status === "suspended") {
    // idempotent: already in target state, nothing to do.
    return
  }

  await tenants.suspendTenant(supabase, id, reason)
  await audit.emitAudit(supabase, {
    tenant_id: id,
    actor_type: "platform_admin",
    actor_id: user.id,
    action: "tenant.suspend",
    resource: `tenant:${id}`,
    payload: { reason, from_status: t.status },
  })

  revalidatePath(`/tenants/${id}`)
  revalidatePath(`/tenants/${id}/suspend`)
}

export async function resumeTenantAction(formData: FormData): Promise<void> {
  const user = await requirePlatformUser()
  const id = String(formData.get("tenantId") ?? "")
  if (!id) throw new Error("tenantId required")

  const supabase = await createControlClient()
  const { data: t, error } = await supabase.from("tenants")
    .select("status").eq("id", id).maybeSingle()
  if (error) throw new Error(`load tenant: ${error.message}`)
  if (!t) throw new Error(`tenant ${id} not found`)
  if (t.status !== "suspended") {
    // only a suspended tenant can be resumed — refuse to flip a
    // provisioning/failed/pending tenant into active behind the pipeline's back.
    throw new Error(`tenant ${id} is ${t.status}, only a suspended tenant can be resumed`)
  }

  await tenants.resumeTenant(supabase, id)
  await audit.emitAudit(supabase, {
    tenant_id: id,
    actor_type: "platform_admin",
    actor_id: user.id,
    action: "tenant.resume",
    resource: `tenant:${id}`,
    payload: {},
  })

  revalidatePath(`/tenants/${id}`)
  revalidatePath(`/tenants/${id}/suspend`)
}
