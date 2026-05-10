import { describe, it, expect } from "vitest"
import { randomBytes } from "node:crypto"
import { encrypt } from "@realreal/control-db"
import { decryptServiceRoleKey } from "../src/lib/crypto"

describe("decryptServiceRoleKey", () => {
  it("round-trips a service role key via encrypt / decryptServiceRoleKey", () => {
    const kek = randomBytes(32)
    const plaintext = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.serviceRoleKey"

    const blob = encrypt(plaintext, kek)
    const result = decryptServiceRoleKey(blob, kek)

    expect(result).toBe(plaintext)
  })

  it("throws on wrong KEK (auth tag mismatch)", () => {
    const kek = randomBytes(32)
    const wrongKek = randomBytes(32)
    const blob = encrypt("some-key", kek)

    expect(() => decryptServiceRoleKey(blob, wrongKek)).toThrow()
  })

  it("throws when KEK is not 32 bytes", () => {
    const blob = randomBytes(40)
    expect(() => decryptServiceRoleKey(blob, Buffer.alloc(16))).toThrow("KEK must be 32 bytes")
  })

  it("throws when blob is too short", () => {
    const kek = randomBytes(32)
    expect(() => decryptServiceRoleKey(Buffer.alloc(10), kek)).toThrow("encrypted blob too short")
  })
})
