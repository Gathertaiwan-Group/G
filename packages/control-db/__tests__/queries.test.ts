import { describe, it, expect, vi } from "vitest"
import { createTenant, updateTenantStatus } from "../src/queries/tenants"
import { upsertInfrastructure, getInfrastructure } from "../src/queries/infrastructure"
import { recordStripeEvent } from "../src/queries/stripe-events"

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
