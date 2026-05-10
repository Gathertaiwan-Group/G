import { Router, type Request, type Response } from "express"
import Stripe from "stripe"
import pino from "pino"
import { createControlClient } from "@realreal/control-db"

const log = pino({ name: "stripe-webhook" })

// In-memory idempotency cache. Phase A only — Phase D will move this to a
// persistent table (stripe_events) so multi-instance + restarts dedupe correctly.
const seenEventIds = new Set<string>()
const SEEN_MAX = 5000

function rememberEvent(id: string) {
  seenEventIds.add(id)
  if (seenEventIds.size > SEEN_MAX) {
    // Drop the oldest by recreating from the tail. Simple FIFO trimming.
    const tail = Array.from(seenEventIds).slice(-Math.floor(SEEN_MAX / 2))
    seenEventIds.clear()
    for (const t of tail) seenEventIds.add(t)
  }
}

let cachedClient: Stripe | null = null
function getStripe(): Stripe | null {
  if (cachedClient) return cachedClient
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  cachedClient = new Stripe(key, { apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion })
  return cachedClient
}

export const stripeWebhookRouter = Router()

// Note: this router MUST be mounted with raw body middleware
// (e.g. `app.use("/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRouter)`)
// BEFORE the global express.json() middleware. Stripe signatures are computed
// over the exact request bytes — any reparsing breaks verification.
stripeWebhookRouter.post("/", async (req: Request, res: Response) => {
  const sig = req.header("stripe-signature")
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    log.warn("STRIPE_WEBHOOK_SECRET not configured; rejecting webhook")
    res.status(503).json({ error: "stripe_webhook_not_configured" })
    return
  }
  if (!sig) {
    res.status(400).json({ error: "missing_signature" })
    return
  }
  const stripe = getStripe()
  if (!stripe) {
    res.status(503).json({ error: "stripe_client_not_configured" })
    return
  }

  let event: Stripe.Event
  try {
    // req.body is a Buffer because of express.raw().
    const raw = req.body as Buffer
    event = stripe.webhooks.constructEvent(raw, sig, secret)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "verify_failed"
    log.warn({ err: msg }, "stripe signature verification failed")
    res.status(400).json({ error: "invalid_signature", detail: msg })
    return
  }

  // Idempotency: dedupe on Stripe's event.id.
  if (seenEventIds.has(event.id)) {
    log.info({ eventId: event.id, type: event.type }, "duplicate stripe event; skipping")
    res.status(200).json({ received: true, duplicate: true })
    return
  }
  rememberEvent(event.id)

  // Phase A: log only. Phase D will dispatch to handlers (subscription
  // lifecycle, invoice paid/failed, customer events, etc.).
  log.info({ eventId: event.id, type: event.type }, "received stripe event (no handlers in Phase A)")

  // Touch the control client so a missing config surfaces here, but don't
  // fail the webhook just because audit emit fails — Stripe will retry.
  try {
    createControlClient()
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "control db client unavailable")
  }

  res.status(200).json({ received: true })
})
