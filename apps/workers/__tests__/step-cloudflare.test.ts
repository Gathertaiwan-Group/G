import { describe, it, expect, vi, beforeEach } from "vitest"

// ADAPTATION (matches step-supabase.test.ts / dispatch.test.ts): the plan
// declares the mock fn as a plain top-level `const` referenced inside the
// hoisted `vi.mock` factory → "Cannot access ... before initialization". We
// move it into vi.hoisted(), keeping the plan's assertions verbatim.
const { upsertCnameRecord } = vi.hoisted(() => ({ upsertCnameRecord: vi.fn() }))
vi.mock("@realreal/provisioning/clients/cloudflare", () => ({ upsertCnameRecord }))
import { cloudflareDnsHandler } from "../src/provisioning/steps/cloudflare-dns"

const ctx = (custom: string | null) => ({
  client: {}, kek: Buffer.alloc(32), platformDomain: "foo.platform.realreal.cc",
  infra: { cloudflare_zone_id: null }, tenant: { id: "t1", slug: "foo", custom_domain: custom },
}) as never

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CLOUDFLARE_API_TOKEN = "cf"
  process.env.CLOUDFLARE_PLATFORM_ZONE_ID = "zone1"
})

describe("cloudflare_dns", () => {
  it("creates CNAME foo.platform.realreal.cc -> vercel for platform subdomain", async () => {
    await cloudflareDnsHandler.run(ctx(null))
    expect(upsertCnameRecord).toHaveBeenCalledWith({
      token: "cf", zoneId: "zone1",
      name: "foo.platform.realreal.cc", content: "cname.vercel-dns.com",
    })
  })
  it("BYO tenant: no platform DNS write (records emailed instead)", async () => {
    await cloudflareDnsHandler.run(ctx("mybrand.com"))
    expect(upsertCnameRecord).not.toHaveBeenCalled()
  })
  it("isComplete always false (run reconciles idempotently)", async () => {
    expect(await cloudflareDnsHandler.isComplete(ctx(null))).toBe(false)
  })
  it("throws when CLOUDFLARE env not set (no DNS write)", async () => {
    delete process.env.CLOUDFLARE_API_TOKEN
    await expect(cloudflareDnsHandler.run(ctx(null))).rejects.toThrow(/CLOUDFLARE_API_TOKEN/)
    expect(upsertCnameRecord).not.toHaveBeenCalled()
  })
  it("mgmt-API failure propagates so dispatcher retries", async () => {
    upsertCnameRecord.mockRejectedValue(new Error("upsertCnameRecord:create 502"))
    await expect(cloudflareDnsHandler.run(ctx(null))).rejects.toThrow(/502/)
  })
})
