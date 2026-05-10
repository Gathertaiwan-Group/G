import pino from "pino"
import cron from "node-cron"
import Stripe from "stripe"

const log = pino({ name: "cron-stripe-sync" })

let cachedClient: Stripe | null = null
function getStripe(): Stripe | null {
  if (cachedClient) return cachedClient
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  cachedClient = new Stripe(key, { apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion })
  return cachedClient
}

// Skeleton: Phase D will reconcile each tenant's Stripe subscription status
// against the control DB (`tenant_billing.subscription_status`). For now the
// cron is wired but only logs so we can confirm the schedule.
export async function runStripeSyncOnce(): Promise<void> {
  try {
    const stripe = getStripe()
    if (!stripe) {
      log.info("stripe-sync skeleton (STRIPE_SECRET_KEY not set; nothing to do)")
      return
    }
    log.info("stripe-sync skeleton (no reconciliation in Phase A)")
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "stripe-sync tick failed")
  }
}

export function scheduleStripeSync(): cron.ScheduledTask {
  const task = cron.schedule("0 4 * * *", () => {
    void runStripeSyncOnce()
  })
  log.info("scheduled stripe-sync daily at 04:00 UTC")
  return task
}
