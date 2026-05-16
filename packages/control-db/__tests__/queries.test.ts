import { describe, it, expect, vi } from "vitest"
import { createTenant, updateTenantStatus } from "../src/queries/tenants"
import { upsertInfrastructure, getInfrastructure } from "../src/queries/infrastructure"
import { recordStripeEvent } from "../src/queries/stripe-events"
import { reapStuckRunningJobs } from "../src/queries/jobs"

function mockClient(impl: Record<string, unknown>) {
  return impl as never
}

describe("createTenant", () => {
  it("inserts a pending_payment tenant and returns its id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "t1" }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const c = mockClient({ from: vi.fn().mockReturnValue({ insert }) })
    const id = await createTenant(c, { slug: "foo", custom_domain: null,
      owner_user_id: "u1", plan: "standard" })
    expect(id).toBe("t1")
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      slug: "foo", status: "pending_payment", owner_user_id: "u1", plan: "standard",
    }))
  })
})

describe("recordStripeEvent", () => {
  it("returns false (already processed) when insert hits unique violation 23505", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: "23505" } })
    const c = mockClient({ from: vi.fn().mockReturnValue({ insert }) })
    const fresh = await recordStripeEvent(c, "evt_1", "checkout.session.completed", {})
    expect(fresh).toBe(false)
  })
  it("returns true on a fresh insert", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const c = mockClient({ from: vi.fn().mockReturnValue({ insert }) })
    expect(await recordStripeEvent(c, "evt_2", "x", {})).toBe(true)
  })
})

describe("upsertInfrastructure", () => {
  it("encrypts the service_role key with the KEK before upsert", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const c = mockClient({ from: vi.fn().mockReturnValue({ upsert }) })
    const kek = Buffer.alloc(32, 7)
    await upsertInfrastructure(c, "t1", {
      supabase_project_ref: "ref", supabase_url: "https://ref.supabase.co",
      supabase_anon_key: "anon", supabase_service_role_key: "secret-sr",
    }, kek)
    const row = upsert.mock.calls[0][0]
    expect(row.supabase_service_role_key_encrypted).toBeInstanceOf(Buffer)
    expect(row).not.toHaveProperty("supabase_service_role_key")
  })

  it("encrypts the supabase_db_password with the KEK before upsert", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const c = mockClient({ from: vi.fn().mockReturnValue({ upsert }) })
    const kek = Buffer.alloc(32, 7)
    await upsertInfrastructure(c, "t1", {
      supabase_project_ref: "ref", supabase_db_password: "super-secret-pw",
    }, kek)
    const row = upsert.mock.calls[0][0]
    expect(row.supabase_db_password_encrypted).toBeInstanceOf(Buffer)
    // plaintext must never reach the column / row written to the DB
    expect(row).not.toHaveProperty("supabase_db_password")
    expect(JSON.stringify(row)).not.toContain("super-secret-pw")
  })
})

describe("getInfrastructure", () => {
  it("returns the row when present", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { tenant_id: "t1", supabase_url: "https://ref.supabase.co" }, error: null,
    })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const c = mockClient({ from: vi.fn().mockReturnValue({ select }) })
    const row = await getInfrastructure(c, "t1")
    expect(row?.tenant_id).toBe("t1")
  })
})

describe("reapStuckRunningJobs", () => {
  it("requeues running jobs older than the cutoff and returns them", async () => {
    const select = vi.fn().mockResolvedValue({
      data: [{ id: "j1", step: "supabase_setup", tenant_id: "t1" }],
      error: null,
    })
    const lt = vi.fn().mockReturnValue({ select })
    const eq = vi.fn().mockReturnValue({ lt })
    const update = vi.fn().mockReturnValue({ eq })
    const c = mockClient({ from: vi.fn().mockReturnValue({ update }) })
    const reaped = await reapStuckRunningJobs(c, 30)
    expect(reaped).toEqual([{ id: "j1", step: "supabase_setup", tenant_id: "t1" }])
    // requeues: status -> queued, started_at cleared, available_at refreshed
    const patch = update.mock.calls[0][0]
    expect(patch.status).toBe("queued")
    expect(patch.started_at).toBeNull()
    expect(typeof patch.available_at).toBe("string")
    // only targets running jobs whose started_at is older than cutoff
    expect(eq).toHaveBeenCalledWith("status", "running")
    const [col, cutoff] = lt.mock.calls[0]
    expect(col).toBe("started_at")
    expect(new Date(cutoff).getTime()).toBeLessThan(Date.now() - 29 * 60_000)
  })

  it("returns an empty array when nothing is stuck", async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null })
    const lt = vi.fn().mockReturnValue({ select })
    const eq = vi.fn().mockReturnValue({ lt })
    const update = vi.fn().mockReturnValue({ eq })
    const c = mockClient({ from: vi.fn().mockReturnValue({ update }) })
    expect(await reapStuckRunningJobs(c, 30)).toEqual([])
  })

  it("throws when the update errors", async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } })
    const lt = vi.fn().mockReturnValue({ select })
    const eq = vi.fn().mockReturnValue({ lt })
    const update = vi.fn().mockReturnValue({ eq })
    const c = mockClient({ from: vi.fn().mockReturnValue({ update }) })
    await expect(reapStuckRunningJobs(c, 30)).rejects.toBeTruthy()
  })
})

describe("updateTenantStatus", () => {
  it("sets activated_at when status becomes active", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    const c = mockClient({ from: vi.fn().mockReturnValue({ update }) })
    await updateTenantStatus(c, "t1", "active")
    const u = update.mock.calls[0][0]
    expect(u.status).toBe("active")
    expect(typeof u.activated_at).toBe("string")
  })
})
