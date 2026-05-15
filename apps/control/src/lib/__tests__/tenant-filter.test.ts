import { describe, it, expect } from "vitest"
import { parseTenantFilter, TENANT_STATUSES } from "../tenant-filter"

describe("parseTenantFilter", () => {
  it("defaults to no filter, empty search", () => {
    expect(parseTenantFilter({})).toEqual({ status: null, q: "" })
  })
  it("accepts a valid status and trims/normalizes the query", () => {
    expect(parseTenantFilter({ status: "active", q: "  Real " }))
      .toEqual({ status: "active", q: "real" })
  })
  it("rejects an unknown status (treats as no filter)", () => {
    expect(parseTenantFilter({ status: "bogus" })).toEqual({ status: null, q: "" })
  })
  it("exposes the canonical status list", () => {
    expect(TENANT_STATUSES).toEqual([
      "pending_payment", "provisioning", "active", "suspended", "canceled", "failed",
    ])
  })
})
