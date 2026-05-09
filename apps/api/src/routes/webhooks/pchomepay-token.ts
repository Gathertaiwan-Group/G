import { Router } from "express"
import { supabase } from "../../lib/supabase"
import { verifyCheckMacValue } from "../../lib/pchomepay"
import { encryptToken } from "../../lib/token-encryption"
import { getPaymentConfig } from "../../lib/provider-config"

export const pchomepayTokenWebhookRouter = Router()

// POST /webhooks/pchomepay-token — PChomePay token registration callback
// MerchantOrderNo format: TOKREG_{subscriptionId}
pchomepayTokenWebhookRouter.post("/", async (req, res) => {
  const params = req.body as Record<string, string>

  // Verify CheckMacValue (timing-safe)
  const cfg = await getPaymentConfig()
  if (!verifyCheckMacValue(params, cfg.pchomepay_hash_key, cfg.pchomepay_hash_iv)) {
    res.status(400).send("0|SignatureError"); return
  }

  const { MerchantOrderNo, TokenValue, RtnCode } = params

  if (!MerchantOrderNo) {
    res.status(400).send("0|MissingOrderNo"); return
  }

  // Extract subscriptionId from MerchantOrderNo: TOKREG_{subscriptionId}
  const match = MerchantOrderNo.match(/^TOKREG_(.+)$/)
  if (!match) {
    res.status(400).send("0|InvalidOrderNoFormat"); return
  }

  const subscriptionId = match[1]

  // Only process successful token registration
  if (RtnCode !== "1") {
    console.warn(`[webhooks/pchomepay-token] token registration failed for sub ${subscriptionId}, RtnCode=${RtnCode}`)
    res.send("1|OK"); return
  }

  if (!TokenValue) {
    res.status(400).send("0|MissingTokenValue"); return
  }

  // Idempotency guard via webhook_events
  const { error: idempotencyError } = await supabase
    .from("webhook_events")
    .insert({
      gateway: "pchomepay_token",
      merchant_trade_no: MerchantOrderNo,
      payload: JSON.stringify(params),
    })

  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      // Already processed
      res.send("1|OK"); return
    }
    console.error("[webhooks/pchomepay-token] idempotency insert failed:", idempotencyError)
    res.status(500).send("0|InternalError"); return
  }

  // Encrypt the token before storing
  let encryptedToken: string
  try {
    encryptedToken = await encryptToken(TokenValue)
  } catch (err) {
    console.error("[webhooks/pchomepay-token] token encryption failed:", err)
    res.status(500).send("0|EncryptionError"); return
  }

  const { error: updateError } = await supabase
    .from("subscriptions")
    .update({
      payment_method_token: encryptedToken,
      token_key_version: 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId)

  if (updateError) {
    console.error("[webhooks/pchomepay-token] subscription update failed:", updateError)
    res.status(500).send("0|InternalError"); return
  }

  res.send("1|OK")
})
