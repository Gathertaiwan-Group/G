import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

// vi.hoisted: the vi.mock factory is hoisted above module init, so the mock
// fns must be created in the same hoisted scope (vitest 4 TDZ on top-level
// `const` referenced from a hoisted factory).
const { recordStripeEvent, createTenant, enqueueJobs } = vi.hoisted(() => ({
  recordStripeEvent: vi.fn(),
  createTenant: vi.fn(),
  enqueueJobs: vi.fn(),
}))
vi.mock("@realreal/control-db", () => ({
  createControlClient: () => ({}),
  stripeEvents: { recordStripeEvent },
  tenants: { createTenant },
  jobs: { enqueueJobs },
}))
vi.mock("stripe", () => ({
  default: class {
    webhooks = {
      constructEvent: (raw: Buffer) => JSON.parse(raw.toString()),
    }
  },
}))

import { buildApp } from "../src/index"

// Post raw JSON bytes to the Stripe raw-body endpoint. supertest/superagent
// re-serializes a Buffer body when an `application/json` content-type is set
// (turning it into `{"type":"Buffer","data":[...]}`), which would break
// signature/parse. Sending a string under an explicit content-type with the
// identity serializer transmits the exact bytes express.raw() needs.
function postEvent(payload: unknown) {
  return request(buildApp())
    .post("/webhooks/stripe")
    .set("stripe-signature", "sig")
    .set("content-type", "application/json")
    .serialize((v: unknown) => v as string)
    .send(JSON.stringify(payload))
}

const EVENT = {
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: {
    metadata: { slug: "pioneer-test", plan: "standard", owner_user_id: "u1" },
    customer: "cus_1",
  } },
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  process.env.STRIPE_SECRET_KEY = "sk_test_x"
  vi.clearAllMocks()
  recordStripeEvent.mockResolvedValue(true)
  createTenant.mockResolvedValue("t1")
  enqueueJobs.mockResolvedValue(undefined)
})

describe("POST /webhooks/stripe", () => {
  it("creates a tenant and enqueues the 8 provisioning steps", async () => {
    const res = await postEvent(EVENT)
    expect(res.status).toBe(200)
    expect(createTenant).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      slug: "pioneer-test", owner_user_id: "u1", plan: "standard",
    }))
    expect(enqueueJobs).toHaveBeenCalledWith(expect.anything(), "t1", [
      "validate", "supabase_setup", "resend_setup", "cloudflare_dns",
      "vercel_setup", "railway_setup", "domain_finalize", "tenant_finalize",
    ])
  })

  it("is idempotent: duplicate event does not re-enqueue", async () => {
    recordStripeEvent.mockResolvedValue(false)
    const res = await postEvent(EVENT)
    expect(res.status).toBe(200)
    expect(res.body.duplicate).toBe(true)
    expect(createTenant).not.toHaveBeenCalled()
    expect(enqueueJobs).not.toHaveBeenCalled()
  })

  it("ignores non-provisioning event types", async () => {
    const res = await postEvent({ ...EVENT, type: "invoice.paid" })
    expect(res.status).toBe(200)
    expect(createTenant).not.toHaveBeenCalled()
  })
})
