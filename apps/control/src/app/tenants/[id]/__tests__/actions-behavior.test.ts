import { describe, it, expect, vi, beforeEach } from "vitest"

// requirePlatformUser() redirects (throws) for unauthenticated/non-platform
// users; on success it returns the platform_users row. We toggle this per test.
const requirePlatformUserMock = vi.fn()
vi.mock("@/lib/auth", () => ({
  requirePlatformUser: () => requirePlatformUserMock(),
}))

const createControlClientMock = vi.fn()
vi.mock("@/lib/control-db", () => ({
  createControlClient: () => createControlClientMock(),
}))

const revalidatePathMock = vi.fn()
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePathMock(p),
}))

const requeueStepMock = vi.fn()
const suspendTenantMock = vi.fn()
const resumeTenantMock = vi.fn()
const emitAuditMock = vi.fn()
vi.mock("@realreal/control-db", () => ({
  jobs: { requeueStep: (...a: unknown[]) => requeueStepMock(...a) },
  tenants: {
    suspendTenant: (...a: unknown[]) => suspendTenantMock(...a),
    resumeTenant: (...a: unknown[]) => resumeTenantMock(...a),
  },
  audit: { emitAudit: (...a: unknown[]) => emitAuditMock(...a) },
}))

import { retryProvisioningStep } from "../provision/actions"
import { suspendTenantAction, resumeTenantAction } from "../suspend/actions"

const PLATFORM_USER = { id: "admin-1", email: "ops@example.com", auth_user_id: "u1" }

/**
 * Builds a fake supabase client whose `.from(table)` returns a thenable
 * query builder. `selectResults` maps table -> the {data,error} the read
 * resolves to; `updateCalls` records every .update() patch + .eq() filters.
 */
function fakeSupabase(selectResults: Record<string, { data: unknown; error: unknown }>) {
  const updates: { table: string; patch: Record<string, unknown>; eqs: [string, unknown][] }[] = []
  function from(table: string) {
    let mode: "select" | "update" = "select"
    let patch: Record<string, unknown> = {}
    const eqs: [string, unknown][] = []
    const builder: Record<string, unknown> = {
      select() { mode = "select"; return builder },
      update(p: Record<string, unknown>) { mode = "update"; patch = p; return builder },
      eq(col: string, val: unknown) {
        eqs.push([col, val])
        return builder
      },
      maybeSingle: async () => selectResults[table] ?? { data: null, error: null },
      // update chains are awaited directly (`await client.from().update().eq()`)
      // — capture the full eq chain at await time, not on the first .eq().
      then(res: (v: { error: unknown }) => void) {
        if (mode === "update") updates.push({ table, patch, eqs: [...eqs] })
        res({ error: (selectResults[table]?.error) ?? null })
      },
    }
    return builder
  }
  return { client: { from } as never, updates }
}

beforeEach(() => {
  requirePlatformUserMock.mockReset()
  createControlClientMock.mockReset()
  revalidatePathMock.mockReset()
  requeueStepMock.mockReset()
  suspendTenantMock.mockReset()
  resumeTenantMock.mockReset()
  emitAuditMock.mockReset()
})

function fd(o: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

describe("retryProvisioningStep", () => {
  it("rejects unauthorized callers BEFORE any DB access", async () => {
    requirePlatformUserMock.mockRejectedValue(new Error("__redirect:/auth/login"))
    await expect(
      retryProvisioningStep(fd({ tenantId: "t1", step: "vercel_setup" })),
    ).rejects.toThrow("__redirect:/auth/login")
    expect(createControlClientMock).not.toHaveBeenCalled()
    expect(requeueStepMock).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it("re-queues a failed step, un-sticks the tenant, and writes audit", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    const { client, updates } = fakeSupabase({
      provisioning_jobs: { data: { status: "failed" }, error: null },
    })
    createControlClientMock.mockResolvedValue(client)

    await retryProvisioningStep(fd({ tenantId: "t1", step: "vercel_setup" }))

    expect(requeueStepMock).toHaveBeenCalledWith(client, "t1", "vercel_setup")
    // tenant un-stick is scoped to status=failed (idempotent / safe)
    const tenantUpdate = updates.find(u => u.table === "tenants")
    expect(tenantUpdate?.patch).toMatchObject({ status: "provisioning" })
    expect(tenantUpdate?.eqs).toContainEqual(["id", "t1"])
    expect(tenantUpdate?.eqs).toContainEqual(["status", "failed"])
    // audit written with platform-admin actor
    expect(emitAuditMock).toHaveBeenCalledWith(client, expect.objectContaining({
      tenant_id: "t1",
      actor_type: "platform_admin",
      actor_id: "admin-1",
      action: "provisioning.retry_step",
      payload: { step: "vercel_setup" },
    }))
    expect(revalidatePathMock).toHaveBeenCalledWith("/tenants/t1/provision")
  })

  it("refuses to retry a step that is not in failed state (invalid transition)", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    const { client } = fakeSupabase({
      provisioning_jobs: { data: { status: "running" }, error: null },
    })
    createControlClientMock.mockResolvedValue(client)
    await expect(
      retryProvisioningStep(fd({ tenantId: "t1", step: "vercel_setup" })),
    ).rejects.toThrow(/only failed steps are retryable/)
    expect(requeueStepMock).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it("throws when tenantId/step missing", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    await expect(retryProvisioningStep(fd({ tenantId: "t1" }))).rejects.toThrow(
      /tenantId and step required/,
    )
  })
})

describe("suspendTenantAction", () => {
  it("rejects unauthorized callers before DB access", async () => {
    requirePlatformUserMock.mockRejectedValue(new Error("__redirect:/auth/login"))
    await expect(
      suspendTenantAction(fd({ tenantId: "t1", reason: "x" })),
    ).rejects.toThrow("__redirect:/auth/login")
    expect(suspendTenantMock).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })

  it("suspends an active tenant and writes audit", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    const { client } = fakeSupabase({
      tenants: { data: { status: "active" }, error: null },
    })
    createControlClientMock.mockResolvedValue(client)

    await suspendTenantAction(fd({ tenantId: "t1", reason: "fraud review" }))

    expect(suspendTenantMock).toHaveBeenCalledWith(client, "t1", "fraud review")
    expect(emitAuditMock).toHaveBeenCalledWith(client, expect.objectContaining({
      tenant_id: "t1",
      actor_type: "platform_admin",
      actor_id: "admin-1",
      action: "tenant.suspend",
      payload: { reason: "fraud review", from_status: "active" },
    }))
    expect(revalidatePathMock).toHaveBeenCalledWith("/tenants/t1")
  })

  it("is idempotent — already-suspended tenant is a no-op (no double write/audit)", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    const { client } = fakeSupabase({
      tenants: { data: { status: "suspended" }, error: null },
    })
    createControlClientMock.mockResolvedValue(client)
    await suspendTenantAction(fd({ tenantId: "t1", reason: "again" }))
    expect(suspendTenantMock).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })
})

describe("resumeTenantAction", () => {
  it("rejects unauthorized callers before DB access", async () => {
    requirePlatformUserMock.mockRejectedValue(new Error("__redirect:/auth/login"))
    await expect(
      resumeTenantAction(fd({ tenantId: "t1" })),
    ).rejects.toThrow("__redirect:/auth/login")
    expect(resumeTenantMock).not.toHaveBeenCalled()
  })

  it("resumes a suspended tenant and writes audit", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    const { client } = fakeSupabase({
      tenants: { data: { status: "suspended" }, error: null },
    })
    createControlClientMock.mockResolvedValue(client)

    await resumeTenantAction(fd({ tenantId: "t1" }))

    expect(resumeTenantMock).toHaveBeenCalledWith(client, "t1")
    expect(emitAuditMock).toHaveBeenCalledWith(client, expect.objectContaining({
      tenant_id: "t1",
      actor_type: "platform_admin",
      action: "tenant.resume",
    }))
  })

  it("refuses to resume a non-suspended tenant (invalid transition)", async () => {
    requirePlatformUserMock.mockResolvedValue(PLATFORM_USER)
    const { client } = fakeSupabase({
      tenants: { data: { status: "provisioning" }, error: null },
    })
    createControlClientMock.mockResolvedValue(client)
    await expect(resumeTenantAction(fd({ tenantId: "t1" }))).rejects.toThrow(
      /only a suspended tenant can be resumed/,
    )
    expect(resumeTenantMock).not.toHaveBeenCalled()
    expect(emitAuditMock).not.toHaveBeenCalled()
  })
})
