import { describe, it, expect, vi } from "vitest"
import express from "express"
import request from "supertest"
import { requireModule } from "../src/express"

function fake(value: Record<string, boolean>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: { value }, error: null }) }),
      }),
    }),
  } as never
}

describe("requireModule", () => {
  it("404s when module disabled", async () => {
    const app = express()
    app.get("/courses", requireModule("courses", { supabase: fake({ courses: false }) }), (_req, res) => res.json({ ok: true }))
    const res = await request(app).get("/courses")
    expect(res.status).toBe(404)
  })
  it("passes through when enabled", async () => {
    const app = express()
    app.get("/courses", requireModule("courses", { supabase: fake({ courses: true }) }), (_req, res) => res.json({ ok: true }))
    const res = await request(app).get("/courses")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
  it("caches reads within ttl window", async () => {
    const calls = vi.fn()
    const supa = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => {
              calls()
              return { data: { value: { courses: true } }, error: null }
            },
          }),
        }),
      }),
    } as never
    const app = express()
    app.get("/courses", requireModule("courses", { supabase: supa, ttlMs: 60_000 }), (_req, res) => res.json({}))
    await request(app).get("/courses")
    await request(app).get("/courses")
    expect(calls).toHaveBeenCalledTimes(1)
  })
})
