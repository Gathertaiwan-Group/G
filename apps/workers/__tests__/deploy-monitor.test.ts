import { describe, it, expect, vi } from "vitest"

// Mock the Slack alert helper so the monitor's alertOps calls are observable
// and NEVER hit the network (vi.hoisted convention — mock factory must not
// reference outer scope).
const { alertOpsMock } = vi.hoisted(() => ({ alertOpsMock: vi.fn() }))
vi.mock("../src/provisioning/notify", () => ({
  alertOps: alertOpsMock,
}))

import { evaluateMonitorTick, runMonitorPass } from "../src/cron/deploy-monitor"

describe("evaluateMonitorTick", () => {
  it("flags a tenant for rollback after 3 consecutive failures", () => {
    const r = evaluateMonitorTick({
      tenantId: "t1",
      recent: [false, false, false, true], // newest first: 3-streak fail
    })
    expect(r.shouldRollback).toBe(true)
  })
  it("does not roll back on 2 failures", () => {
    expect(
      evaluateMonitorTick({ tenantId: "t1", recent: [false, false, true] })
        .shouldRollback,
    ).toBe(false)
  })
  it("does not roll back when healthy", () => {
    expect(
      evaluateMonitorTick({ tenantId: "t1", recent: [true, true, true] })
        .shouldRollback,
    ).toBe(false)
  })
  it("does not roll back with fewer than 3 samples (insufficient signal)", () => {
    expect(
      evaluateMonitorTick({ tenantId: "t1", recent: [false, false] })
        .shouldRollback,
    ).toBe(false)
  })
})

describe("runMonitorPass", () => {
  it("rolls back exactly once and alerts when a tenant has a 3-streak", async () => {
    alertOpsMock.mockClear()
    const rollback = vi.fn(async () => {})
    await runMonitorPass({
      listActiveTenantsWithInfra: async () => [
        {
          tenantId: "t1",
          slug: "acme",
          recent: [false, false, false, true],
          vercelProjectId: "prj_1",
          railwayApiServiceId: "svc_1",
        },
      ],
      rollback,
    })
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(rollback).toHaveBeenCalledWith({
      vercelProjectId: "prj_1",
      railwayApiServiceId: "svc_1",
    })
    expect(alertOpsMock).toHaveBeenCalledTimes(1)
    expect(alertOpsMock.mock.calls[0][0]).toMatch(/Auto-rollback executed for acme/)
  })

  it("does NOT roll back or alert a healthy tenant", async () => {
    alertOpsMock.mockClear()
    const rollback = vi.fn(async () => {})
    await runMonitorPass({
      listActiveTenantsWithInfra: async () => [
        {
          tenantId: "t1",
          slug: "healthy",
          recent: [true, true, true],
          vercelProjectId: "prj_1",
          railwayApiServiceId: "svc_1",
        },
      ],
      rollback,
    })
    expect(rollback).not.toHaveBeenCalled()
    expect(alertOpsMock).not.toHaveBeenCalled()
  })

  it("does NOT rollback-loop: a tenant already rolled back (now recovering) is not rolled back again", async () => {
    // After a rollback, the next health tick is green, so the newest sample
    // is `true`. evaluateMonitorTick keys ONLY on the 3 most-recent samples,
    // so a single recovered tick (true at head) breaks the 3-streak and the
    // monitor will not fire again — no rollback loop even though older
    // samples are still failures.
    alertOpsMock.mockClear()
    const rollback = vi.fn(async () => {})
    await runMonitorPass({
      listActiveTenantsWithInfra: async () => [
        {
          tenantId: "t1",
          slug: "recovering",
          recent: [true, false, false, false], // post-rollback: head is green
          vercelProjectId: "prj_1",
          railwayApiServiceId: "svc_1",
        },
      ],
      rollback,
    })
    expect(rollback).not.toHaveBeenCalled()
    expect(alertOpsMock).not.toHaveBeenCalled()
  })

  it("alerts a FAILED rollback (manual intervention) and still does not loop", async () => {
    alertOpsMock.mockClear()
    const rollback = vi.fn(async () => {
      throw new Error("vercel 500")
    })
    await runMonitorPass({
      listActiveTenantsWithInfra: async () => [
        {
          tenantId: "t1",
          slug: "acme",
          recent: [false, false, false],
          vercelProjectId: "prj_1",
          railwayApiServiceId: "svc_1",
        },
      ],
      rollback,
    })
    // Exactly one rollback attempt (no retry loop), and a FAILED alert.
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(alertOpsMock).toHaveBeenCalledTimes(1)
    expect(alertOpsMock.mock.calls[0][0]).toMatch(/Auto-rollback FAILED for acme/)
  })

  it("only rolls back the regressed tenant in a mixed fleet", async () => {
    alertOpsMock.mockClear()
    const rollback = vi.fn(async () => {})
    await runMonitorPass({
      listActiveTenantsWithInfra: async () => [
        {
          tenantId: "ok",
          slug: "good",
          recent: [true, true, true],
          vercelProjectId: "prj_ok",
          railwayApiServiceId: "svc_ok",
        },
        {
          tenantId: "bad",
          slug: "broken",
          recent: [false, false, false],
          vercelProjectId: "prj_bad",
          railwayApiServiceId: "svc_bad",
        },
      ],
      rollback,
    })
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(rollback).toHaveBeenCalledWith({
      vercelProjectId: "prj_bad",
      railwayApiServiceId: "svc_bad",
    })
  })
})
