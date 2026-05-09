import { createHmac, timingSafeEqual } from "crypto"

/**
 * Compute a SHA-256 HMAC of `body` using `secret` and return the hex digest.
 */
export function signRequest(body: string, secret: string): string {
  if (!secret) throw new Error("hmac secret is required")
  return createHmac("sha256", secret).update(body, "utf8").digest("hex")
}

/**
 * Constant-time verification of an incoming HMAC signature against the body.
 * Returns false (never throws) on length mismatch, bad hex, or mismatch.
 */
export function verifySignature(body: string, providedHex: string, secret: string): boolean {
  if (!secret || !providedHex) return false
  let provided: Buffer
  try {
    provided = Buffer.from(providedHex, "hex")
  } catch {
    return false
  }
  // Buffer.from on bad hex silently drops chars; check that it round-trips.
  if (provided.length === 0 || provided.toString("hex") !== providedHex.toLowerCase()) return false
  const expected = Buffer.from(signRequest(body, secret), "hex")
  if (expected.length !== provided.length) return false
  return timingSafeEqual(expected, provided)
}
