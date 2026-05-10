import { describe, it, expect } from "vitest"
import { signRequest, verifySignature } from "../src/lib/hmac"

const SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa"

describe("hmac", () => {
  it("signRequest produces a hex digest of the body using the shared secret", () => {
    const body = JSON.stringify({ hello: "world" })
    const sig = signRequest(body, SECRET)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  it("verifySignature returns true for a matching signature and false otherwise", () => {
    const body = JSON.stringify({ a: 1 })
    const sig = signRequest(body, SECRET)
    expect(verifySignature(body, sig, SECRET)).toBe(true)
    expect(verifySignature(body, sig, "different-secret-bbbbbbbbbbbbbbbbb")).toBe(false)
    expect(verifySignature(body + "tampered", sig, SECRET)).toBe(false)
  })

  it("verifySignature returns false on length mismatch instead of throwing", () => {
    const body = "{}"
    expect(verifySignature(body, "deadbeef", SECRET)).toBe(false)
    expect(verifySignature(body, "", SECRET)).toBe(false)
  })
})
