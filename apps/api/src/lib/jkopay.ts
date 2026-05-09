import { createHmac, timingSafeEqual } from "crypto"
import { getPaymentConfig } from "./provider-config"

// JKOPay Online Payment API — https://developer.jkopay.com/
// NOTE: JKOPay does NOT support recurring / token payments. For subscriptions, use PChomePay only.

const BASE_URL = process.env.JKOPAY_SANDBOX === "true"
  ? "https://uat-api.jkopay.com"
  : "https://api.jkopay.com"

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const computed = createHmac("sha256", secret).update(payload).digest("hex")
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch {
    return false
  }
}

export async function initiatePayment(
  orderId: string,
  amount: number
): Promise<{ paymentUrl: string; merchantTradeNo: string }> {
  const merchantTradeNo = `RRJ${Date.now()}`
  const siteUrl = process.env.SITE_URL ?? "https://realreal.cc"
  const cfg = await getPaymentConfig()

  const bodyObj = {
    store_id: cfg.jkopay_store_id,
    merchant_trade_no: merchantTradeNo,
    currency: "TWD",
    total_price: amount,
    order_desc: `realreal.cc 訂單 ${orderId.slice(0, 8)}`,
    result_url: `${siteUrl}/webhooks/jkopay/result`,
    notify_url: `${siteUrl}/api/webhooks/jkopay`,
  }
  const payload = JSON.stringify(bodyObj)
  const signature = createHmac("sha256", cfg.jkopay_secret_key).update(payload).digest("hex")

  const response = await fetch(`${BASE_URL}/order/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Store-ID": cfg.jkopay_store_id,
      "X-Api-Key": cfg.jkopay_api_key,
      "X-Signature": signature,
    },
    body: payload,
  })
  const data = await response.json() as Record<string, any>
  if (!data.payment_url) {
    throw new Error(`JKOPay error: ${JSON.stringify(data)}`)
  }
  return { paymentUrl: data.payment_url as string, merchantTradeNo }
}
