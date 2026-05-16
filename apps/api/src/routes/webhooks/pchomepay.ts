import { Router } from "express"
import { supabase } from "../../lib/supabase"
import { verifyCheckMacValue } from "../../lib/pchomepay"
import { getPaymentConfig } from "../../lib/provider-config"

export const pchomepayWebhookRouter = Router()

// POST /webhooks/pchomepay — PChomePay server notification
// PChomePay sends form-encoded POST; must return "1|OK" on success
pchomepayWebhookRouter.post("/", async (req, res) => {
  const params = req.body as Record<string, string>

  // Verify CheckMacValue (timing-safe)
  const cfg = await getPaymentConfig()
  if (!verifyCheckMacValue(params, cfg.pchomepay_hash_key, cfg.pchomepay_hash_iv)) {
    res.status(400).send("0|SignatureError"); return
  }

  const { MerchantTradeNo, RtnCode } = params
  if (!MerchantTradeNo) {
    res.status(400).send("0|MissingTradeNo"); return
  }

  // Idempotency guard — insert into webhook_events, catch unique constraint "23505"
  const { error: idempotencyError } = await supabase
    .from("webhook_events")
    .insert({
      gateway: "pchomepay",
      merchant_trade_no: MerchantTradeNo,
      payload: JSON.stringify(params),
    })

  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      // Duplicate webhook — already processed, return success
      res.send("1|OK"); return
    }
    console.error("[webhooks/pchomepay] idempotency insert failed:", idempotencyError)
    res.status(500).send("0|InternalError"); return
  }

  const success = RtnCode === "1"

  // Find the payment by gateway_tx_id. For PChomePay, orders.ts stores the
  // MerchantTradeNo (= order_number) as payments.gateway_tx_id, and PChomePay
  // echoes that same value back here as MerchantTradeNo.
  const { data: payment } = await supabase
    .from("payments")
    .select("id, order_id")
    .eq("gateway_tx_id", MerchantTradeNo)
    .single()

  if (payment) {
    await supabase
      .from("payments")
      .update({ status: success ? "captured" : "failed" })
      .eq("id", payment.id)

    await supabase
      .from("orders")
      .update({
        status: success ? "processing" : "failed",
        payment_status: success ? "paid" : "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.order_id)

    if (success) {
      // Enqueue email + invoice jobs
      try {
        const { enqueuePostPaymentJobs } = await import("../../lib/enqueue-post-payment")
        await enqueuePostPaymentJobs(payment.order_id)
      } catch (err) {
        console.warn("[webhooks/pchomepay] enqueue jobs failed (non-fatal):", err)
      }
    }
  }

  // PChomePay requires this exact response
  res.send("1|OK")
})
