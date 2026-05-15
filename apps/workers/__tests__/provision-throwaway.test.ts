import { describe, it, expect, afterEach } from "vitest"
import { assertLiveAllowed } from "../../../scripts/provision-throwaway"

// These tests exercise ONLY the safety guard / arg parsing. They never
// import @realreal/control-db's runtime client nor hit any live service.
describe("provision-throwaway safety", () => {
  afterEach(() => {
    delete process.env.ALLOW_LIVE_PROVISION
  })

  it("throws unless ALLOW_LIVE_PROVISION=yes", () => {
    delete process.env.ALLOW_LIVE_PROVISION
    expect(() => assertLiveAllowed()).toThrow(/ALLOW_LIVE_PROVISION/)
  })

  it("throws when ALLOW_LIVE_PROVISION is set to anything other than 'yes'", () => {
    process.env.ALLOW_LIVE_PROVISION = "true"
    expect(() => assertLiveAllowed()).toThrow(/ALLOW_LIVE_PROVISION/)
  })

  it("passes when explicitly allowed", () => {
    process.env.ALLOW_LIVE_PROVISION = "yes"
    expect(() => assertLiveAllowed()).not.toThrow()
  })
})
