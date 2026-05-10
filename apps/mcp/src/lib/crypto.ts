import { createDecipheriv } from "node:crypto"

const ALGO = "aes-256-gcm"
const IV_LEN = 12
const TAG_LEN = 16

/**
 * Decrypt a service role key that was encrypted with AES-256-GCM.
 * Format: 12-byte IV || ciphertext || 16-byte auth tag
 */
export function decryptServiceRoleKey(encrypted: Buffer, kek: Buffer): string {
  if (kek.length !== 32) throw new Error("KEK must be 32 bytes")
  if (encrypted.length < IV_LEN + TAG_LEN + 1) throw new Error("encrypted blob too short")

  const iv = encrypted.subarray(0, IV_LEN)
  const tag = encrypted.subarray(encrypted.length - TAG_LEN)
  const ct = encrypted.subarray(IV_LEN, encrypted.length - TAG_LEN)

  const decipher = createDecipheriv(ALGO, kek, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
}
