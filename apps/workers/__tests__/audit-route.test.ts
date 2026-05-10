import { describe, it, expect, beforeEach, vi } from "vitest"
import express, { type Express } from "express"
import request from "supertest"
import { signRequest } from "../src/lib/hmac"

const SECRET = "test-internal-secret-zzzzzzzzzzzzzz"

// Capture inserts to the control DB.
const inserted: unknown[] = []

vi.mock("@realreal/control-db", () => {
  return {
    createControlClient: () => ({} as unknown),
    audit: {
      emitAudit: async (_c: unknown, entry: unknown) => {
        inserted.push(entry)
      },
    },
  }
})

async function buildApp(): Promise<Express> {
  process.env.INTERNAL_API_SECRET = SECRET
  const { auditRouter } = await import("../src/routes/audit")
  const app = express()
  app.use("/internal/audit", auditRouter)
  return app
}

describe("POST /internal/audit", () => {
  beforeEach(() => {
    inserted.length = 0
  })

  it("rejects requests without a signature", async () => {
    const app = await buildApp()
    const res = await request(app).post("/internal/audit").send({
      tenant_id: null,
      actor_type: "system",
      actor_id: null,
      action: "test.event",
      resource: null,
      payload: { ok: true },
    })
    expect(res.status).toBe(401)
    expect(inserted).toHaveLength(0)
  })

  it("rejects requests with an invalid signature", async () => {
    const app = await buildApp()
    const body = {
      tenant_id: null,
      actor_type: "system" as const,
      actor_id: null,
      action: "test.event",
      resource: null,
      payload: { ok: true },
    }
    const res = await request(app)
      .post("/internal/audit")
      .set("x-internal-signature", "deadbeef".repeat(8))
      .send(body)
    expect(res.status).toBe(401)
    expect(inserted).toHaveLength(0)
  })

  it("accepts a properly signed request and inserts the audit entry", async () => {
    const app = await buildApp()
    const body = {
      tenant_id: null,
      actor_type: "system" as const,
      actor_id: null,
      action: "test.event",
      resource: "test:resource",
      payload: { ok: true },
    }
    const raw = JSON.stringify(body)
    const sig = signRequest(raw, SECRET)
    const res = await request(app)
      .post("/internal/audit")
      .set("content-type", "application/json")
      .set("x-internal-signature", sig)
      .send(raw)
    expect(res.status).toBe(202)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ action: "test.event", resource: "test:resource" })
  })
})
