import pino from "pino"
import cron from "node-cron"

const log = pino({ name: "cron-resend-dkim" })

const VERIFY_TIMEOUT_MS = 10_000

// Skeleton: Phase B will iterate tenants whose Resend domain status is
// "pending" and call the Resend verify endpoint. The fetch wrapper here
// already enforces a timeout via AbortSignal so the cron tick can't hang.
async function verifyOneDomain(domainId: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`https://api.resend.com/domains/${domainId}/verify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`resend verify failed: ${res.status} ${res.statusText}`)
  return await res.json().catch(() => ({}))
}

export async function runResendDkimVerifyOnce(): Promise<void> {
  try {
    // Phase A: nothing to iterate yet. Just log so we can see the cron firing.
    log.info("resend-dkim-verify skeleton (no pending domains yet)")
    // Reference verifyOneDomain so it isn't tree-shaken / flagged unused.
    void verifyOneDomain
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "dkim-verify tick failed")
  }
}

export function scheduleResendDkimVerify(): cron.ScheduledTask {
  const task = cron.schedule("0 * * * *", () => {
    void runResendDkimVerifyOnce()
  })
  log.info("scheduled resend dkim verify every hour")
  return task
}
