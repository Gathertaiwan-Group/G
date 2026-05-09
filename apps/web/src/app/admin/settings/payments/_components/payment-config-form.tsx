"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

const FIELDS_BY_PROVIDER: Record<string, Array<{ key: string; label: string; type?: "password" | "text" }>> = {
  pchomepay: [
    { key: "pchomepay_app_id", label: "App ID" },
    { key: "pchomepay_secret", label: "Secret", type: "password" },
    { key: "pchomepay_hash_key", label: "Hash Key", type: "password" },
    { key: "pchomepay_hash_iv", label: "Hash IV", type: "password" },
  ],
  linepay: [
    { key: "linepay_channel_id", label: "Channel ID" },
    { key: "linepay_channel_secret", label: "Channel Secret", type: "password" },
  ],
  jkopay: [
    { key: "jkopay_store_id", label: "Store ID" },
    { key: "jkopay_api_key", label: "API Key", type: "password" },
    { key: "jkopay_secret_key", label: "Secret Key", type: "password" },
  ],
  ecpay: [
    { key: "ecpay_merchant_id", label: "Merchant ID" },
    { key: "ecpay_hash_key", label: "Hash Key", type: "password" },
    { key: "ecpay_hash_iv", label: "Hash IV", type: "password" },
  ],
  amego: [
    { key: "amego_tax_id", label: "公司統編 (Tax ID)" },
    { key: "amego_app_key", label: "App Key", type: "password" },
    { key: "amego_webhook_secret", label: "Webhook Secret", type: "password" },
  ],
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

interface Props { provider: keyof typeof FIELDS_BY_PROVIDER }

async function getToken(): Promise<string> {
  const supabase = createClient()
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ""
}

export default function PaymentConfigForm({ provider }: Props) {
  const fields = FIELDS_BY_PROVIDER[provider]
  const [values, setValues] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const token = await getToken()
        const res = await fetch(`${API_URL}/admin/payment-config`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const j = await res.json() as { data: Record<string, string> }
        if (!alive) return
        setCurrent(j.data ?? {})
      } catch (e) {
        if (alive) setStatus(`讀取失敗：${(e as Error).message}`)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      const payload: Record<string, string> = {}
      for (const f of fields) {
        const v = values[f.key]
        if (v !== undefined && v.length > 0) payload[f.key] = v
      }
      if (Object.keys(payload).length === 0) {
        setStatus("沒有變更"); return
      }
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/payment-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const refresh = await fetch(`${API_URL}/admin/payment-config`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const r = await refresh.json() as { data: Record<string, string> }
      setCurrent(r.data ?? {})
      setValues({})
      setStatus("✓ 已儲存（5 分鐘內生效）")
    } catch (e) {
      setStatus(`儲存失敗：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">讀取中…</p>

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {fields.map((f) => {
        const existing = current[f.key] ?? ""
        const masked = existing.length > 0 ? `${existing.slice(0, 4)}••••${existing.slice(-2)}` : "（未設定）"
        return (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input
              id={f.key}
              type={f.type === "password" ? "password" : "text"}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={`目前：${masked}`}
              autoComplete="off"
            />
          </div>
        )
      })}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
        {status && <span className="text-sm text-muted-foreground">{status}</span>}
      </div>
    </form>
  )
}
