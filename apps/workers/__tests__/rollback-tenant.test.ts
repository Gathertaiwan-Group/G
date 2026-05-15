import { describe, it, expect, vi, afterEach } from "vitest"
import { rollbackTenant } from "../../../scripts/rollback-tenant"

// No root vitest config exists, so — matching the established
// scripts/provision-throwaway.ts → apps/workers/__tests__/provision-throwaway.test.ts
// pattern (plan PR-E4 Step 2) — this test lives under apps/workers/__tests__
// and imports the script via a relative path. All network is stubbed; no live
// Vercel/Railway rollback API call is ever made.
afterEach(() => vi.unstubAllGlobals())

describe("rollbackTenant", () => {
  it("calls Vercel rollback then Railway redeploy-previous with stored ids", async () => {
    const calls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url))
        // Vercel rollback lists READY deployments first, then promotes the
        // previous one; Railway redeploys via GraphQL. Return shapes both
        // client helpers expect so the happy path completes.
        if (String(url).includes("/deployments?")) {
          return new Response(
            JSON.stringify({
              deployments: [
                { uid: "dpl_new", readyState: "READY" },
                { uid: "dpl_prev", readyState: "READY" },
              ],
            }),
            { status: 200 },
          )
        }
        return new Response(
          JSON.stringify({ data: { serviceInstanceRedeploy: true } }),
          { status: 200 },
        )
      }),
    )
    await rollbackTenant({
      vercelProjectId: "prj_1",
      railwayApiServiceId: "svc_1",
      vercelToken: "vt",
      railwayToken: "rt",
    })
    expect(calls.some((u) => u.includes("vercel.com"))).toBe(true)
    expect(calls.some((u) => u.includes("railway"))).toBe(true)
  })

  it("throws (non-zero) when Vercel rollback fails so the workflow fails loud", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    )
    await expect(
      rollbackTenant({
        vercelProjectId: "p",
        railwayApiServiceId: "s",
        vercelToken: "v",
        railwayToken: "r",
      }),
    ).rejects.toThrow(/rollback/i)
  })
})
