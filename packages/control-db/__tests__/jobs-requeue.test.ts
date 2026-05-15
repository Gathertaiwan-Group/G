import { describe, it, expect, vi } from "vitest"
import { requeueStep } from "../src/queries/jobs"
import { suspendTenant, resumeTenant } from "../src/queries/tenants"

function fakeClient(captured: {
  table?: string
  patch?: Record<string, unknown>
  eqs: [string, unknown][]
}) {
  const builder = {
    update(p: Record<string, unknown>) {
      captured.patch = p
      return builder
    },
    eq(col: string, val: unknown) {
      captured.eqs.push([col, val])
      return builder
    },
    then(res: (v: { error: null }) => void) {
      res({ error: null })
    },
  }
  return { from(t: string) { captured.table = t; return builder } } as never
}

describe("requeueStep", () => {
  it("re-queues exactly the one (tenant, step) job with attempt reset", async () => {
    const cap = { eqs: [] as [string, unknown][] } as {
      table?: string
      patch?: Record<string, unknown>
      eqs: [string, unknown][]
    }
    await requeueStep(fakeClient(cap), "ten-1", "vercel_setup")
    expect(cap.table).toBe("provisioning_jobs")
    expect(cap.patch).toMatchObject({
      status: "queued",
      attempt: 0,
      last_error: null,
      started_at: null,
    })
    expect(typeof cap.patch!.available_at).toBe("string")
    expect(cap.eqs).toContainEqual(["tenant_id", "ten-1"])
    expect(cap.eqs).toContainEqual(["step", "vercel_setup"])
  })

  it("throws when the update errors", async () => {
    const builder = {
      update() { return builder },
      eq() { return builder },
      then(res: (v: { error: { message: string } }) => void) {
        res({ error: { message: "boom" } })
      },
    }
    const c = { from() { return builder } } as never
    await expect(requeueStep(c, "t", "validate")).rejects.toThrow(/boom/)
  })
})

describe("suspendTenant", () => {
  it("sets status=suspended with timestamp + reason scoped to the tenant id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    const c = { from: vi.fn().mockReturnValue({ update }) } as never
    await suspendTenant(c, "t1", "fraud review")
    const u = update.mock.calls[0][0]
    expect(u.status).toBe("suspended")
    expect(u.suspended_reason).toBe("fraud review")
    expect(typeof u.suspended_at).toBe("string")
    expect(eq).toHaveBeenCalledWith("id", "t1")
  })

  it("throws when the update errors", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: "db down" } })
    const update = vi.fn().mockReturnValue({ eq })
    const c = { from: vi.fn().mockReturnValue({ update }) } as never
    await expect(suspendTenant(c, "t1", "x")).rejects.toThrow(/db down/)
  })
})

describe("resumeTenant", () => {
  it("restores status=active and clears suspension fields", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    const c = { from: vi.fn().mockReturnValue({ update }) } as never
    await resumeTenant(c, "t1")
    const u = update.mock.calls[0][0]
    expect(u.status).toBe("active")
    expect(u.suspended_at).toBeNull()
    expect(u.suspended_reason).toBeNull()
    expect(eq).toHaveBeenCalledWith("id", "t1")
  })

  it("throws when the update errors", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: "nope" } })
    const update = vi.fn().mockReturnValue({ eq })
    const c = { from: vi.fn().mockReturnValue({ update }) } as never
    await expect(resumeTenant(c, "t1")).rejects.toThrow(/nope/)
  })
})
