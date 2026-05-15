import { describe, it, expect, vi, afterEach } from "vitest"
import { mgmtFetch } from "../http"

afterEach(() => vi.unstubAllGlobals())

// Typed accessors for the stubbed fetch mock's recorded call args.
type FetchInit = { method: string; headers: Record<string, string>; body: string }
const callInit = (f: { mock: { calls: unknown[] } }, i: number): FetchInit =>
  (f.mock.calls[i] as unknown[])[1] as FetchInit
const callUrl = (f: { mock: { calls: unknown[] } }, i: number): string =>
  (f.mock.calls[i] as unknown[])[0] as string

describe("mgmtFetch", () => {
  it("sends bearer auth + json and returns parsed body on 200", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    )
    vi.stubGlobal("fetch", f)
    const out = await mgmtFetch<{ ok: number }>("https://x/y", {
      method: "POST", token: "tok", body: { a: 1 }, label: "test",
    })
    expect(out).toEqual({ ok: 1 })
    const init = callInit(f, 0)
    expect(init.headers.Authorization).toBe("Bearer tok")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
  })

  it("throws with label + status body on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("nope", { status: 422 }),
    ))
    await expect(
      mgmtFetch("https://x", { method: "GET", token: "t", label: "createProj" }),
    ).rejects.toThrow(/createProj: 422 nope/)
  })
})

import { createSupabaseProject, pollProjectHealthy, runTenantSql } from "../supabase-mgmt"

describe("supabase-mgmt", () => {
  it("createSupabaseProject returns ref + url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "ref123", endpoint: "https://ref123.supabase.co" }),
      { status: 201 })))
    const p = await createSupabaseProject({
      pat: "pat", name: "tenant-foo", region: "ap-northeast-1", orgId: "org", dbPass: "pw",
    })
    expect(p).toEqual({ ref: "ref123", url: "https://ref123.supabase.co" })
  })

  it("pollProjectHealthy resolves when status becomes ACTIVE_HEALTHY", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "COMING_UP" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ACTIVE_HEALTHY" }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await expect(pollProjectHealthy("pat", "ref123", { intervalMs: 1, maxMs: 1000 }))
      .resolves.toBeUndefined()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("runTenantSql posts query to the project SQL endpoint", async () => {
    const f = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }))
    vi.stubGlobal("fetch", f)
    await runTenantSql("pat", "ref123", "select 1", "smoke")
    expect(callUrl(f, 0)).toBe("https://api.supabase.com/v1/projects/ref123/database/query")
  })
})

import { createVercelProject, setVercelEnv, triggerVercelDeploy, pollVercelReady,
         addVercelDomain, rollbackVercel } from "../vercel"
import { createRailwayProject, createRailwayService, setRailwayVars,
         deployRailwayService, pollRailwayHealthz,
         getRailwayEnvironmentId, createRailwayServiceDomain } from "../railway"
import { addResendDomain, getResendDnsRecords, pollResendVerified } from "../resend"
import { upsertCnameRecord } from "../cloudflare"

describe("vercel", () => {
  it("createVercelProject links the G repo production branch", async () => {
    const f = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: "prj_1" }), { status: 200 })))
    vi.stubGlobal("fetch", f)
    const id = await createVercelProject({
      token: "t", name: "tenant-foo", repo: "Gathertaiwan-Group/G",
      branch: "production", rootDir: "apps/web",
    })
    expect(id).toBe("prj_1")
    expect(JSON.parse(callInit(f, 0).body).gitRepository.repo).toBe("Gathertaiwan-Group/G")
  })

  it("setVercelEnv posts each key as an env entry", async () => {
    const f = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))
    vi.stubGlobal("fetch", f)
    await setVercelEnv("t", "prj_1", { FOO: "bar", BAZ: "qux" })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("triggerVercelDeploy returns the deployment id", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "dpl_9" }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    const id = await triggerVercelDeploy("t", "prj_1")
    expect(id).toBe("dpl_9")
  })

  it("pollVercelReady resolves with url when READY", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ readyState: "BUILDING" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ readyState: "READY", url: "dpl.vercel.app" }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await expect(pollVercelReady("t", "dpl_9", { intervalMs: 1, maxMs: 1000 }))
      .resolves.toBe("https://dpl.vercel.app")
  })

  it("addVercelDomain posts the domain", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await addVercelDomain("t", "prj_1", "foo.platform.realreal.cc")
    expect(JSON.parse(callInit(f, 0).body).name).toBe("foo.platform.realreal.cc")
  })

  it("rollbackVercel promotes the previous READY deployment", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        deployments: [
          { uid: "dpl_new", readyState: "READY" },
          { uid: "dpl_prev", readyState: "READY" },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await rollbackVercel("t", "prj_1")
    expect(f).toHaveBeenCalledTimes(2)
    expect(callUrl(f, 1)).toContain("dpl_prev")
  })
})

describe("railway", () => {
  it("createRailwayProject returns the project id from graphql", async () => {
    const f = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { projectCreate: { id: "rwp_1" } } }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    const id = await createRailwayProject("t", "tenant-foo")
    expect(id).toBe("rwp_1")
  })

  it("createRailwayService returns the service id", async () => {
    const f = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { serviceCreate: { id: "rws_1" } } }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    const id = await createRailwayService("t", "rwp_1", "web", "Gathertaiwan-Group/G", "production", "apps/web")
    expect(id).toBe("rws_1")
  })

  it("setRailwayVars sends a variableCollectionUpsert mutation", async () => {
    const f = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { variableCollectionUpsert: true } }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await setRailwayVars("t", "rws_1", { FOO: "bar" })
    expect(JSON.parse(callInit(f, 0).body).query).toContain("variableCollectionUpsert")
  })

  it("deployRailwayService sends a serviceInstanceRedeploy mutation", async () => {
    const f = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { serviceInstanceRedeploy: true } }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await deployRailwayService("t", "rws_1")
    expect(JSON.parse(callInit(f, 0).body).query).toContain("serviceInstanceRedeploy")
  })

  it("pollRailwayHealthz resolves when health endpoint returns 200", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("bad", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
    vi.stubGlobal("fetch", f)
    await expect(pollRailwayHealthz("https://svc.up.railway.app", { intervalMs: 1, maxMs: 1000 }))
      .resolves.toBeUndefined()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("getRailwayEnvironmentId returns the production environment node id", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { project: { environments: { edges: [
        { node: { id: "env_stg", name: "staging" } },
        { node: { id: "env_prod", name: "production" } },
      ] } } },
    }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    const id = await getRailwayEnvironmentId("t", "rwp_1")
    expect(id).toBe("env_prod")
    expect(callUrl(f, 0)).toBe("https://backboard.railway.app/graphql/v2")
    const body = JSON.parse(callInit(f, 0).body)
    expect(body.query).toContain("environments")
    expect(body.variables).toEqual({ id: "rwp_1" })
  })

  it("getRailwayEnvironmentId falls back to the first environment when no production", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { project: { environments: { edges: [
        { node: { id: "env_only", name: "default" } },
      ] } } },
    }), { status: 200 })))
    expect(await getRailwayEnvironmentId("t", "rwp_1")).toBe("env_only")
  })

  it("getRailwayEnvironmentId throws when graphql returns errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: null, errors: [{ message: "project not found" }],
    }), { status: 200 })))
    await expect(getRailwayEnvironmentId("t", "rwp_x"))
      .rejects.toThrow(/getRailwayEnvironmentId: project not found/)
  })

  it("createRailwayServiceDomain posts serviceDomainCreate and returns the domain", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { serviceDomainCreate: { domain: "api-pioneer.up.railway.app" } },
    }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    const domain = await createRailwayServiceDomain("t", "env_prod", "rws_1")
    expect(domain).toBe("api-pioneer.up.railway.app")
    expect(callUrl(f, 0)).toBe("https://backboard.railway.app/graphql/v2")
    const init = callInit(f, 0)
    expect(init.headers.Authorization).toBe("Bearer t")
    const body = JSON.parse(init.body)
    expect(body.query).toContain("serviceDomainCreate")
    expect(body.variables).toEqual({
      input: { environmentId: "env_prod", serviceId: "rws_1" },
    })
  })

  it("createRailwayServiceDomain throws when graphql returns errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: null, errors: [{ message: "domain limit reached" }],
    }), { status: 200 })))
    await expect(createRailwayServiceDomain("t", "env_prod", "rws_1"))
      .rejects.toThrow(/createRailwayServiceDomain: domain limit reached/)
  })
})

describe("resend", () => {
  it("addResendDomain returns id + dns records", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "dom_1",
      records: [{ record: "DKIM", type: "TXT", name: "resend._domainkey", value: "p=abc" }],
    }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    const out = await addResendDomain("key", "mail.foo.realreal.cc")
    expect(out.id).toBe("dom_1")
    expect(out.records[0]).toEqual({ type: "TXT", name: "resend._domainkey", value: "p=abc" })
  })

  it("getResendDnsRecords maps the records array", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      records: [{ type: "MX", name: "send", value: "feedback-smtp.resend.com" }],
    }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    const recs = await getResendDnsRecords("key", "dom_1")
    expect(recs).toEqual([{ type: "MX", name: "send", value: "feedback-smtp.resend.com" }])
  })

  it("pollResendVerified returns true when status is verified", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "pending" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "verified" }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await expect(pollResendVerified("key", "dom_1", { intervalMs: 1, maxMs: 1000 }))
      .resolves.toBe(true)
  })
})

describe("cloudflare", () => {
  it("upsertCnameRecord creates when absent", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: "rec1" } }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await upsertCnameRecord({ token: "t", zoneId: "z", name: "foo.platform.realreal.cc",
      content: "cname.vercel-dns.com" })
    expect(f).toHaveBeenCalledTimes(2)
    expect(callInit(f, 1).method).toBe("POST")
  })

  it("upsertCnameRecord patches when present", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: [{ id: "rec1", name: "foo.platform.realreal.cc" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { id: "rec1" } }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await upsertCnameRecord({ token: "t", zoneId: "z", name: "foo.platform.realreal.cc",
      content: "cname.vercel-dns.com" })
    expect(f).toHaveBeenCalledTimes(2)
    expect(callInit(f, 1).method).toBe("PATCH")
    expect(callUrl(f, 1)).toContain("rec1")
  })
})
