import cron from "node-cron"
import pino from "pino"
import { createControlClient, jobs } from "@realreal/control-db"
import { alertOps } from "../provisioning/notify"

const log = pino({ name: "stuck-sweep" })

const STUCK_THRESHOLD_MIN = 30

// Re-queue jobs stuck in 'running' past the threshold (spec §9: "provisioning
// stuck >30min" ALERT). A stuck job means a worker claimed it and crashed
// before releasing it; requeueing lets another worker resume idempotently.
export async function sweepStuckJobs(): Promise<void> {
  const reaped = await jobs.reapStuckRunningJobs(
    createControlClient(),
    STUCK_THRESHOLD_MIN,
  )
  if (reaped.length === 0) return
  log.warn({ count: reaped.length }, "requeued stuck running jobs")
  // alertOps degrades gracefully (logs, never throws) if SLACK_WEBHOOK_URL
  // is unset — see provisioning/notify.ts.
  await alertOps(
    `provisioning jobs stuck >${STUCK_THRESHOLD_MIN}min (requeued ${reaped.length})`,
    reaped.map((j) => `${j.tenant_id}/${j.step}`).join(", "))
}

export function scheduleStuckJobSweep(): cron.ScheduledTask {
  const task = cron.schedule("*/5 * * * *", () => {
    void sweepStuckJobs().catch((e) =>
      log.error(
        { e: e instanceof Error ? e.message : e },
        "stuck sweep failed"))
  })
  log.info("scheduled stuck-job sweep every 5 minutes")
  return task
}
