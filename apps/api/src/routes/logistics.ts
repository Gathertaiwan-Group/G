import { Router } from "express"
import { buildCheckMacValue } from "../lib/ecpay-logistics"
import { getPaymentConfig } from "../lib/provider-config"

const MAP_URL = process.env.ECPAY_SANDBOX === "true"
  ? "https://logistics-stage.ecpay.com.tw/Express/map"
  : "https://logistics.ecpay.com.tw/Express/map"

const RAILWAY_API_URL = process.env.RAILWAY_API_URL ?? "http://localhost:4000"
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc"

export const logisticsRouter = Router()

// GET /logistics/map — Generate ECPay store map selection form (auto-submits)
logisticsRouter.get("/map", async (req, res) => {
  const logisticsSubType = (req.query.logisticsSubType as string) ?? "UNIMART"
  const isCollection = (req.query.isCollection as string) ?? "N"

  const merchantTradeNo = `MAP${Date.now()}`
  const cfg = await getPaymentConfig()

  const fields: Record<string, string> = {
    MerchantID: cfg.ecpay_merchant_id,
    MerchantTradeNo: merchantTradeNo,
    LogisticsType: "CVS",
    LogisticsSubType: logisticsSubType,
    IsCollection: isCollection,
    ServerReplyURL: `${RAILWAY_API_URL}/logistics/map-result`,
  }
  fields.CheckMacValue = buildCheckMacValue(fields, cfg.ecpay_hash_key, cfg.ecpay_hash_iv)

  // Build hidden form fields
  const hiddenInputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}" />`)
    .join("\n      ")

  const html = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>ECPay Store Map</title></head>
  <body>
    <form id="ecpay-map-form" method="POST" action="${escapeHtml(MAP_URL)}">
      ${hiddenInputs}
    </form>
    <script>document.getElementById("ecpay-map-form").submit();</script>
  </body>
</html>`

  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.send(html)
})

// POST /logistics/map-result — Receive store selection result from ECPay
logisticsRouter.post("/map-result", (req, res) => {
  const {
    CVSStoreID,
    CVSStoreName,
    CVSAddress,
    LogisticsSubType,
  } = req.body as Record<string, string>

  // Redirect to frontend checkout page with store info as query params
  const params = new URLSearchParams()
  if (CVSStoreID) params.set("cvsStoreId", CVSStoreID)
  if (CVSStoreName) params.set("cvsStoreName", CVSStoreName)
  if (CVSAddress) params.set("cvsAddress", CVSAddress)
  if (LogisticsSubType) params.set("logisticsSubType", LogisticsSubType)

  res.redirect(`${SITE_URL}/checkout?${params.toString()}`)
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}
