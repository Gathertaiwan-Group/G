import { describe, it, expect, vi, beforeEach } from "vitest"
import { dispatchJob } from "../src/provisioning/dispatch"

// vi.hoisted: the vi.mock factory is hoisted above module init, so the mock
// state must be created inside vi.hoisted() to be referenceable there.
const { markJobStatus, requeueJob, loadTenantContext, getHandler, alertOps } = vi.hoisted(() => ({
  markJobStatus: vi.fn(),
  requeueJob: vi.fn(),
  loadTenantContext: vi.fn().mockResolvedValue({ tenant: { id: "t1" } }),
  getHandler: vi.fn(),
  alertOps: vi.fn(),
}))
vi.mock("@realreal/control-db", () => ({
  createControlClient: () => ({}),
  jobs: { markJobStatus, requeueJob },
}))
vi.mock("../src/provisioning/context", () => ({ loadTenantContext }))
vi.mock("../src/provisioning/steps/registry", () => ({ getHandler }))
vi.mock("../src/provisioning/notify", () => ({ alertOps }))

const baseJob = { id: "j1", tenant_id: "t1", step: "validate", attempt: 0 }

beforeEach(() => vi.clearAllMocks())

describe("dispatchJob", () => {
  it("skips run() when isComplete() is true and marks success", async () => {
    getHandler.mockReturnValue({
      step: "validate",
      isComplete: vi.fn().mockResolvedValue(true),
      run: vi.fn(),
    })
    await dispatchJob({ ...baseJob } as never)
    expect(markJobStatus).toHaveBeenCalledWith(expect.anything(), "j1", "success")
  })

  it("runs handler and marks success", async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    getHandler.mockReturnValue({
      step: "validate", isComplete: vi.fn().mockResolvedValue(false), run,
    })
    await dispatchJob({ ...baseJob } as never)
    expect(run).toHaveBeenCalled()
    expect(markJobStatus).toHaveBeenCalledWith(expect.anything(), "j1", "success")
  })

  it("requeues with 30s delay on attempt 0 failure", async () => {
    getHandler.mockReturnValue({
      step: "validate", isComplete: vi.fn().mockResolvedValue(false),
      run: vi.fn().mockRejectedValue(new Error("boom")),
    })
    await dispatchJob({ ...baseJob, attempt: 0 } as never)
    expect(requeueJob).toHaveBeenCalledWith(expect.anything(), "j1", 1, 30_000, "boom")
    expect(markJobStatus).not.toHaveBeenCalledWith(expect.anything(), "j1", "failed")
  })

  it("requeues with 120s delay on attempt 1 failure", async () => {
    getHandler.mockReturnValue({
      step: "validate", isComplete: vi.fn().mockResolvedValue(false),
      run: vi.fn().mockRejectedValue(new Error("boom2")),
    })
    await dispatchJob({ ...baseJob, attempt: 1 } as never)
    expect(requeueJob).toHaveBeenCalledWith(expect.anything(), "j1", 2, 120_000, "boom2")
  })

  it("marks failed (no requeue) on attempt 2 failure", async () => {
    getHandler.mockReturnValue({
      step: "validate", isComplete: vi.fn().mockResolvedValue(false),
      run: vi.fn().mockRejectedValue(new Error("fatal")),
    })
    await dispatchJob({ ...baseJob, attempt: 2 } as never)
    expect(markJobStatus).toHaveBeenCalledWith(expect.anything(), "j1", "failed",
      { last_error: "fatal" })
    expect(requeueJob).not.toHaveBeenCalled()
  })

  it("calls alertOps when a step fails permanently (attempt 2)", async () => {
    getHandler.mockReturnValue({
      step: "validate", isComplete: vi.fn().mockResolvedValue(false),
      run: vi.fn().mockRejectedValue(new Error("fatal")),
    })
    await dispatchJob({ ...baseJob, attempt: 2 } as never)
    expect(alertOps).toHaveBeenCalledWith(
      expect.stringContaining("provisioning failed"),
      expect.stringContaining("validate"))
  })

  it("does not alert when a step is requeued (attempt 0)", async () => {
    getHandler.mockReturnValue({
      step: "validate", isComplete: vi.fn().mockResolvedValue(false),
      run: vi.fn().mockRejectedValue(new Error("transient")),
    })
    await dispatchJob({ ...baseJob, attempt: 0 } as never)
    expect(alertOps).not.toHaveBeenCalled()
  })

  it("marks failed when no handler is registered", async () => {
    getHandler.mockReturnValue(undefined)
    await dispatchJob({ ...baseJob, step: "bogus" } as never)
    expect(markJobStatus).toHaveBeenCalledWith(expect.anything(), "j1", "failed",
      expect.objectContaining({ last_error: expect.stringContaining("no handler") }))
  })
})
