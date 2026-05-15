import { Router, type Request, type Response } from "express"
import Stripe from "stripe"
import pino from "pino"
import { createControlClient, stripeEvents, tenants, jobs,
         type ProvisioningStep } from "@realreal/control-db"

const log = pino({ name: "stripe-webhook" })

const STEPS: ProvisioningStep[] = [
  "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
  "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
]

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

  let client
  try {
    client = createControlClient()
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "control db unavailable")
    res.status(503).json({ error: "control_db_unavailable" })
    return
  }

  const fresh = await stripeEvents.recordStripeEvent(client, event.id, event.type, event)
  if (!fresh) {
    log.info({ eventId: event.id }, "duplicate stripe event; skipping")
    res.status(200).json({ received: true, duplicate: true })
    return
  }

  if (event.type !== "checkout.session.completed") {
    log.info({ eventId: event.id, type: event.type }, "non-provisioning event; recorded only")
    res.status(200).json({ received: true })
    return
  }

  const obj = (event.data.object ?? {}) as {
    metadata?: { slug?: string; plan?: string; owner_user_id?: string }
  }
  const md = obj.metadata ?? {}
  if (!md.slug || !md.owner_user_id) {
    log.error({ eventId: event.id }, "checkout missing slug/owner_user_id metadata")
    res.status(200).json({ received: true, error: "missing_metadata" })
    return
  }

  try {
    const tenantId = await tenants.createTenant(client, {
      slug: md.slug,
      custom_domain: null,
      owner_user_id: md.owner_user_id,
      plan: md.plan ?? "standard",
    })
    await jobs.enqueueJobs(client, tenantId, STEPS)
    log.info({ eventId: event.id, tenantId, slug: md.slug }, "tenant created + 8 steps enqueued")
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, "provisioning enqueue failed")
    // 500 → Stripe retries; recordStripeEvent already de-dupes a successful path.
    res.status(500).json({ error: "enqueue_failed" })
    return
  }

  res.status(200).json({ received: true })
  return
})
