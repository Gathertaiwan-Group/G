import pino from "pino"
import { createControlClient, jobs } from "@realreal/control-db"

const log = pino({ name: "job-runner" })

const POLL_INTERVAL_MS = 1_000
let timer: NodeJS.Timeout | null = null
let inFlight = false
let stopping = false

async function tick(): Promise<void> {
  if (inFlight || stopping) return
  inFlight = true
  try {
    const client = createControlClient()
    const job = await jobs.claimQueuedJob(client)
    // The underlying RPC returns a `provisioning_jobs` composite row, which
    // becomes an object with all-null columns when no row was claimed (rather
    // than a top-level null). Treat that shape as "no job".
    if (!job || !job.id) return

    log.info(
      { jobId: job.id, tenantId: job.tenant_id, step: job.step, attempt: job.attempt },
      "claimed provisioning job",
    )

    // Phase A has no step handlers yet (those land in Phase B/C). Mark the job
    // as failed with a clear reason so it doesn't sit in `running` forever.
    try {
      await jobs.markJobStatus(client, job.id, "failed", {
        last_error: `no handler for step '${job.step}' in Phase A`,
      })
      log.warn({ jobId: job.id, step: job.step }, "marked job failed: no handler in Phase A")
    } catch (markErr) {
      log.error(
        { jobId: job.id, err: markErr instanceof Error ? markErr.message : markErr },
        "failed to mark job status",
      )
    }
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "job runner tick failed")
  } finally {
    inFlight = false
  }
}

export function startRunner(): void {
  if (timer) {
    log.warn("startRunner called but runner already running")
    return
  }
  stopping = false
  log.info({ intervalMs: POLL_INTERVAL_MS }, "starting provisioning job runner")
  timer = setInterval(() => {
    void tick()
  }, POLL_INTERVAL_MS)
}

export async function stopRunner(): Promise<void> {
  stopping = true
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  // Wait for any in-flight tick to settle (best-effort, bounded).
  const deadline = Date.now() + 5_000
  while (inFlight && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 50))
  }
  log.info("provisioning job runner stopped")
}
