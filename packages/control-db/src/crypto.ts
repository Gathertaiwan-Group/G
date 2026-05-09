import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGO = "aes-256-gcm"
const IV_LEN = 12
const TAG_LEN = 16

/** Encrypt plaintext with a 32-byte KEK. Returns IV || ciphertext || authTag. */
export function encrypt(plaintext: string, kek: Buffer): Buffer {
  if (kek.length !== 32) throw new Error("KEK must be 32 bytes")
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, kek, iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, ct, tag])
}

/** Decrypt blob produced by encrypt(). Throws on tag mismatch / wrong key. */
export function decrypt(blob: Buffer, kek: Buffer): string {
  if (kek.length !== 32) throw new Error("KEK must be 32 bytes")
  if (blob.length < IV_LEN + TAG_LEN + 1) throw new Error("blob too short")
  const iv = blob.subarray(0, IV_LEN)
  const tag = blob.subarray(blob.length - TAG_LEN)
  const ct = blob.subarray(IV_LEN, blob.length - TAG_LEN)
  const decipher = createDecipheriv(ALGO, kek, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
}

/** Parse `PLATFORM_KEK` env var (hex-encoded 32 bytes) into a Buffer. */
export function loadKek(): Buffer {
  const v = process.env.PLATFORM_KEK
  if (!v) throw new Error("PLATFORM_KEK not set")
  const buf = Buffer.from(v, "hex")
  if (buf.length !== 32) throw new Error("PLATFORM_KEK must be 32 hex bytes (64 chars)")
  return buf
}
