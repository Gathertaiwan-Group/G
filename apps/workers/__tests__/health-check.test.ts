import { describe, it, expect, beforeEach, vi } from "vitest"

// Per-test fixtures the control-db mock reads from.
let activeTenants: Array<{ id: string }> = []
let infraByTenant: Record<string, unknown> = {}
let listShouldReject = false
const recorded: Array<{ client: unknown; row: Record<string, unknown> }> = []

vi.mock("@realreal/control-db", () => {
  return {
    createControlClient: () => ({ __control: true }) as unknown,
    tenants: {
      listActiveTenants: async () => {
        if (listShouldReject) throw new Error("control db down")
        return activeTenants
      },
      getTenantInfrastructure: async (_c: unknown, tenantId: string) => {
        return infraByTenant[tenantId] ?? null
      },
    },
    health: {
      recordHealth: async (client: unknown, row: Record<string, unknown>) => {
        recorded.push({ client, row })
      },
    },
  }
})

async function freshRun() {
  vi.resetModules()
  const mod = await import("../src/cron/health-check")
  return mod.runHealthCheckOnce
}

function okResponse(status = 200) {
  return { ok: status >= 200 && status < 300, status } as Response
}

describe("runHealthCheckOnce", () => {
  beforeEach(() => {
    activeTenants = []
    infraByTenant = {}
    listShouldReject = false
    recorded.length = 0
    vi.unstubAllGlobals()
  })

  it("records all four *_ok true for a fully healthy tenant", async () => {
    activeTenants = [{ id: "t1" }]
    infraByTenant = {
      t1: {
        tenant_id: "t1",
        vercel_deployment_url: "https://store.example.com",
        railway_api_url: "https://api.example.com",
        railway_mcp_url: "https://mcp.example.com",
        supabase_url: "https://db.example.com",
        supabase_anon_key: "anon-key-t1",
      },
    }
    const fetchMock = vi.fn(async () => okResponse(200))
    vi.stubGlobal("fetch", fetchMock)

    const run = await freshRun()
    await run()

    expect(recorded).toHaveLength(1)
    expect(recorded[0].row).toMatchObject({
      tenant_id: "t1",
      vercel_ok: true,
      api_ok: true,
      mcp_ok: true,
      supabase_ok: true,
    })

    // Supabase probe must carry the tenant's anon key as the apikey header.
    const supabaseCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("db.example.com"),
    )
    expect(supabaseCall).toBeDefined()
    const init = supabaseCall?.[1] as RequestInit | undefined
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.apikey).toBe("anon-key-t1")
    expect(headers?.Authorization).toBe("Bearer anon-key-t1")
  })

  it("missing/empty anon key → supabase_ok false with 'no anon key' note, no throw", async () => {
    activeTenants = [{ id: "t1" }]
    infraByTenant = {
      t1: {
        tenant_id: "t1",
        vercel_deployment_url: "https://store.example.com",
        railway_api_url: "https://api.example.com",
        railway_mcp_url: "https://mcp.example.com",
        supabase_url: "https://db.example.com",
        supabase_anon_key: "",
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        // Supabase returns 401 when no apikey header is present.
        if (input.includes("db.example.com")) return okResponse(401)
        return okResponse(200)
      }),
    )

    const run = await freshRun()
    await expect(run()).resolves.toBeUndefined()

    expect(recorded).toHaveLength(1)
    expect(recorded[0].row.supabase_ok).toBe(false)
    const details = recorded[0].row.details as { supabase?: unknown }
    expect(details.supabase).toBe("no anon key")
  })

  it("api 500 + mcp fetch rejects → api_ok/mcp_ok false, others true, still recorded once", async () => {
    activeTenants = [{ id: "t1" }]
    infraByTenant = {
      t1: {
        tenant_id: "t1",
        vercel_deployment_url: "https://store.example.com",
        railway_api_url: "https://api.example.com",
        railway_mcp_url: "https://mcp.example.com",
        supabase_url: "https://db.example.com",
        supabase_anon_key: "anon-key-t1",
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("api.example.com")) return okResponse(500)
        if (input.includes("mcp.example.com")) throw new Error("timeout")
        return okResponse(200)
      }),
    )

    const run = await freshRun()
    await run()

    expect(recorded).toHaveLength(1)
    expect(recorded[0].row).toMatchObject({
      vercel_ok: true,
      api_ok: false,
      mcp_ok: false,
      supabase_ok: true,
    })
  })

  it("null railway_mcp_url → mcp_ok false with details note, no throw", async () => {
    activeTenants = [{ id: "t1" }]
    infraByTenant = {
      t1: {
        tenant_id: "t1",
        vercel_deployment_url: "https://store.example.com",
        railway_api_url: "https://api.example.com",
        railway_mcp_url: null,
        supabase_url: "https://db.example.com",
        supabase_anon_key: "anon-key-t1",
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse(200)),
    )

    const run = await freshRun()
    await expect(run()).resolves.toBeUndefined()

    expect(recorded).toHaveLength(1)
    expect(recorded[0].row.mcp_ok).toBe(false)
    const details = recorded[0].row.details as { mcp?: unknown }
    expect(details.mcp).toBe("no url")
  })

  it("first tenant's probe set throws unexpectedly → second tenant still recorded", async () => {
    activeTenants = [{ id: "t1" }, { id: "t2" }]
    infraByTenant = {
      t1: {
        tenant_id: "t1",
        vercel_deployment_url: "https://bad.example.com",
        railway_api_url: "https://api.example.com",
        railway_mcp_url: "https://mcp.example.com",
        supabase_url: "https://db.example.com",
        supabase_anon_key: "anon-key-t1",
      },
      t2: {
        tenant_id: "t2",
        vercel_deployment_url: "https://store2.example.com",
        railway_api_url: "https://api2.example.com",
        railway_mcp_url: "https://mcp2.example.com",
        supabase_url: "https://db2.example.com",
        supabase_anon_key: "anon-key-t2",
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        // t1 endpoints synchronously explode the whole probe path.
        if (input.includes("bad.example.com") || input.includes("api.example.com")) {
          throw new Error("catastrophic")
        }
        return okResponse(200)
      }),
    )

    const run = await freshRun()
    await expect(run()).resolves.toBeUndefined()

    const t2 = recorded.find((r) => r.row.tenant_id === "t2")
    expect(t2).toBeDefined()
    expect(t2?.row).toMatchObject({ vercel_ok: true, api_ok: true })
  })

  it("does not reject even if listActiveTenants rejects", async () => {
    listShouldReject = true
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse(200)),
    )

    const run = await freshRun()
    await expect(run()).resolves.toBeUndefined()
    expect(recorded).toHaveLength(0)
  })
})
