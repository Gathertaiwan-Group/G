import { supabase } from "./supabase"

export interface PaymentConfig {
  pchomepay_app_id: string
  pchomepay_secret: string
  pchomepay_hash_key: string
  pchomepay_hash_iv: string
  linepay_channel_id: string
  linepay_channel_secret: string
  jkopay_store_id: string
  jkopay_api_key: string
  jkopay_secret_key: string
  ecpay_merchant_id: string
  ecpay_hash_key: string
  ecpay_hash_iv: string
  amego_tax_id: string
  amego_app_key: string
  amego_webhook_secret: string
}

export const PAYMENT_FIELDS: ReadonlyArray<keyof PaymentConfig> = [
  "pchomepay_app_id", "pchomepay_secret", "pchomepay_hash_key", "pchomepay_hash_iv",
  "linepay_channel_id", "linepay_channel_secret",
  "jkopay_store_id", "jkopay_api_key", "jkopay_secret_key",
  "ecpay_merchant_id", "ecpay_hash_key", "ecpay_hash_iv",
  "amego_tax_id", "amego_app_key", "amego_webhook_secret",
] as const

const ENV_MAP: Record<keyof PaymentConfig, string> = {
  pchomepay_app_id: "PCHOMEPAY_APP_ID",
  pchomepay_secret: "PCHOMEPAY_SECRET",
  pchomepay_hash_key: "PCHOMEPAY_HASH_KEY",
  pchomepay_hash_iv: "PCHOMEPAY_HASH_IV",
  linepay_channel_id: "LINEPAY_CHANNEL_ID",
  linepay_channel_secret: "LINEPAY_CHANNEL_SECRET",
  jkopay_store_id: "JKOPAY_STORE_ID",
  jkopay_api_key: "JKOPAY_API_KEY",
  jkopay_secret_key: "JKOPAY_SECRET_KEY",
  ecpay_merchant_id: "ECPAY_MERCHANT_ID",
  ecpay_hash_key: "ECPAY_HASH_KEY",
  ecpay_hash_iv: "ECPAY_HASH_IV",
  amego_tax_id: "AMEGO_TAX_ID",
  amego_app_key: "AMEGO_APP_KEY",
  amego_webhook_secret: "AMEGO_WEBHOOK_SECRET",
}

const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

let cache: { value: PaymentConfig; expiresAt: number } | null = null

function envFallback(): PaymentConfig {
  const out = {} as PaymentConfig
  for (const k of PAYMENT_FIELDS) out[k] = process.env[ENV_MAP[k]] ?? ""
  return out
}

async function fetchFromDb(): Promise<Partial<PaymentConfig> | null> {
  const { data, error } = await supabase
    .from("site_contents")
    .select("value")
    .eq("key", "payment_config")
    .maybeSingle()
  if (error) {
    console.warn("[provider-config] DB fetch failed, using env fallback:", error.message)
    return null
  }
  return (data?.value as Partial<PaymentConfig>) ?? null
}

export async function getPaymentConfig(force = false): Promise<PaymentConfig> {
  const now = Date.now()
  if (!force && cache && cache.expiresAt > now) return cache.value
  const env = envFallback()
  const db = await fetchFromDb()
  const merged = { ...env } as PaymentConfig
  if (db) {
    for (const k of PAYMENT_FIELDS) {
      const v = (db as Partial<PaymentConfig>)[k]
      if (typeof v === "string" && v.length > 0) merged[k] = v
    }
  }
  cache = { value: merged, expiresAt: now + CACHE_TTL_MS }
  return merged
}

export function invalidatePaymentConfigCache() { cache = null }
