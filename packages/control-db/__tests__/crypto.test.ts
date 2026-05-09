import { describe, it, expect } from "vitest"
import { encrypt, decrypt } from "../src/crypto"

const KEK = Buffer.from("0".repeat(64), "hex")  // 32 zero bytes for tests

describe("crypto", () => {
  it("encrypt then decrypt round-trips the plaintext", () => {
    const plain = "supabase_service_role_key_xxxxx"
    const cipher = encrypt(plain, KEK)
    const back = decrypt(cipher, KEK)
    expect(back).toBe(plain)
  })

  it("decrypting with wrong key throws", () => {
    const cipher = encrypt("hello", KEK)
    const wrong = Buffer.from("1".repeat(64), "hex")
    expect(() => decrypt(cipher, wrong)).toThrow()
  })

  it("decrypting tampered ciphertext throws (auth tag check)", () => {
    const cipher = encrypt("hello", KEK)
    cipher[cipher.length - 1] ^= 1  // flip last byte
    expect(() => decrypt(cipher, KEK)).toThrow()
  })

  it("emits 12-byte IV prefix", () => {
    const cipher = encrypt("x", KEK)
    expect(cipher.length).toBeGreaterThanOrEqual(12 + 1 + 16)  // IV + ciphertext + tag
  })
})
