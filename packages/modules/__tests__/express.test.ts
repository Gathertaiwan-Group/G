import { describe, it, expect, vi } from "vitest"
import express from "express"
import request from "supertest"
import { requireModule } from "../src/express"

function fake(value: Record<string, boolean>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { value }, error: null }),
        }),
      }),
    }),
  } as never
}

function fakeWithError(error: { message: string }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error }),
        }),
      }),
    }),
  } as never
}

describe("requireModule", () => {
  it("404s when module disabled", async () => {
    const app = express()
    app.get(
      "/courses",
      requireModule("courses", { supabase: fake({ courses: false }) }),
      (_req, res) => res.json({ ok: true })
    )
    const res = await request(app).get("/courses")
    expect(res.status).toBe(404)
  })

  it("passes through when enabled", async () => {
    const app = express()
    app.get(
      "/courses",
      requireModule("courses", { supabase: fake({ courses: true }) }),
      (_req, res) => res.json({ ok: true })
    )
    const res = await request(app).get("/courses")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it("caches successful reads within ttl window", async () => {
    const calls = vi.fn()
    const supa = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              calls()
              return { data: { value: { courses: true } }, error: null }
            },
          }),
        }),
      }),
    } as never
    const app = express()
    app.get(
      "/courses",
      requireModule("courses", { supabase: supa, ttlMs: 60_000 }),
      (_req, res) => res.json({})
    )
    await request(app).get("/courses")
    await request(app).get("/courses")
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it("does not cache errors — recovers on next request after a failure", async () => {
    const calls = vi.fn()
    let mode: "fail" | "ok" = "fail"
    const supa = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              calls()
              if (mode === "fail") return { data: null, error: { message: "transient" } }
              return { data: { value: { courses: true } }, error: null }
            },
          }),
        }),
      }),
    } as never
    const app = express()
    app.get(
      "/courses",
      requireModule("courses", { supabase: supa, ttlMs: 60_000 }),
      (_req, res) => res.json({ ok: true })
    )
    const r1 = await request(app).get("/courses")
    expect(r1.status).toBe(503)
    mode = "ok"
    const r2 = await request(app).get("/courses")
    expect(r2.status).toBe(200)
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it("respects onError: allow policy", async () => {
    const app = express()
    app.get(
      "/courses",
      requireModule("courses", {
        supabase: fakeWithError({ message: "boom" }),
        onError: "allow",
      }),
      (_req, res) => res.json({ ok: true })
    )
    const res = await request(app).get("/courses")
    expect(res.status).toBe(200)
  })
})
