import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted: the vi.mock factories are hoisted above module init, so the
// mock fns must be created inside vi.hoisted() to be referenceable there.
const { reapStuckRunningJobs, alertOps } = vi.hoisted(() => ({
  reapStuckRunningJobs: vi.fn(),
  alertOps: vi.fn(),
}))
vi.mock("@realreal/control-db", () => ({
  createControlClient: () => ({}),
  jobs: { reapStuckRunningJobs },
}))
vi.mock("../src/provisioning/notify", () => ({ alertOps }))

import { sweepStuckJobs } from "../src/cron/stuck-job-sweep"

beforeEach(() => vi.clearAllMocks())

describe("sweepStuckJobs", () => {
  it("requeues jobs running > 30min and alerts", async () => {
    reapStuckRunningJobs.mockResolvedValue([
      { id: "j1", step: "supabase_setup", tenant_id: "t1" },
    ])
    await sweepStuckJobs()
    expect(reapStuckRunningJobs).toHaveBeenCalledWith(expect.anything(), 30)
    expect(alertOps).toHaveBeenCalledWith(
      expect.stringContaining("stuck"),
      expect.stringContaining("supabase_setup"))
  })

  it("no alert when nothing stuck", async () => {
    reapStuckRunningJobs.mockResolvedValue([])
    await sweepStuckJobs()
    expect(alertOps).not.toHaveBeenCalled()
  })

  it("does not throw if alertOps degrades (missing webhook handled in notify)", async () => {
    reapStuckRunningJobs.mockResolvedValue([
      { id: "j2", step: "vercel_setup", tenant_id: "t2" },
    ])
    alertOps.mockResolvedValue(undefined)
    await expect(sweepStuckJobs()).resolves.toBeUndefined()
  })
})
