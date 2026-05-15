import pino from "pino"
import { createControlClient, jobs, type ProvisioningJob } from "@realreal/control-db"
import { loadTenantContext } from "./context"
import { getHandler } from "./steps/registry"

const log = pino({ name: "dispatch" })
const BACKOFF_MS = [30_000, 120_000] as const  // attempt 0 -> 30s, attempt 1 -> 2min

export async function dispatchJob(job: ProvisioningJob): Promise<void> {
  const client = createControlClient()
  const handler = getHandler(job.step)
  if (!handler) {
    await jobs.markJobStatus(client, job.id, "failed",
      { last_error: `no handler for step '${job.step}'` })
    return
  }
  try {
    const ctx = await loadTenantContext(client, job.tenant_id)
    if (await handler.isComplete(ctx)) {
      log.info({ jobId: job.id, step: job.step }, "step already complete; skipping run")
      await jobs.markJobStatus(client, job.id, "success")
      return
    }
    await handler.run(ctx)
    await jobs.markJobStatus(client, job.id, "success")
    log.info({ jobId: job.id, step: job.step }, "step succeeded")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const delay = BACKOFF_MS[job.attempt]
    if (delay !== undefined) {
      log.warn({ jobId: job.id, step: job.step, attempt: job.attempt, msg },
        "step failed; requeueing")
      await jobs.requeueJob(client, job.id, job.attempt + 1, delay, msg)
    } else {
      log.error({ jobId: job.id, step: job.step, msg }, "step failed permanently")
      await jobs.markJobStatus(client, job.id, "failed", { last_error: msg })
      // ALERT: spec §9 — Slack #platform-ops + email. PR-D12 wires alertOps().
    }
  }
}
