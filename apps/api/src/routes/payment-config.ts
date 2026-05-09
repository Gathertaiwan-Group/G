import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { PAYMENT_FIELDS, invalidatePaymentConfigCache } from "../lib/provider-config"

export const paymentConfigRouter = Router()

const updateSchema = z.object(
  Object.fromEntries(PAYMENT_FIELDS.map((k) => [k, z.string().optional()])) as Record<string, z.ZodOptional<z.ZodString>>,
)

// GET /admin/payment-config — return current values from DB
paymentConfigRouter.get("/admin/payment-config", requireAuth, requireAdmin, async (_req, res) => {
  const { data, error } = await supabase
    .from("site_contents")
    .select("value, updated_at")
    .eq("key", "payment_config")
    .maybeSingle()
  if (error) { res.status(500).json({ error: error.message }); return }
  const value = (data?.value as Record<string, string>) ?? {}
  // Ensure all known fields are present (empty string if not set)
  const normalized = Object.fromEntries(PAYMENT_FIELDS.map((k) => [k, value[k] ?? ""]))
  res.json({ data: normalized, updated_at: data?.updated_at ?? null })
})

// PUT /admin/payment-config — upsert values (only updates fields with non-empty string,
// to allow per-field updates without re-typing every secret)
paymentConfigRouter.put("/admin/payment-config", requireAuth, requireAdmin, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() }); return
  }

  // Read existing
  const { data: existing } = await supabase
    .from("site_contents")
    .select("value")
    .eq("key", "payment_config")
    .maybeSingle()
  const current = (existing?.value as Record<string, string>) ?? {}

  // Merge: only update fields where the new value is non-empty (treat empty as "leave alone").
  // To explicitly clear a field, send the exact string "__CLEAR__".
  const next = { ...current }
  for (const k of PAYMENT_FIELDS) {
    const v = parsed.data[k]
    if (v === undefined) continue
    if (v === "__CLEAR__") { next[k] = ""; continue }
    if (v.length === 0) continue  // empty -> leave as-is
    next[k] = v
  }

  const { error } = await supabase
    .from("site_contents")
    .upsert({ key: "payment_config", value: next, updated_at: new Date().toISOString() }, { onConflict: "key" })

  if (error) { res.status(500).json({ error: error.message }); return }

  invalidatePaymentConfigCache()
  res.json({ ok: true })
})
