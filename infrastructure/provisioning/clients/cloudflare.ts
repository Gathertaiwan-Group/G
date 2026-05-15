import { mgmtFetch } from "./http"

const API = "https://api.cloudflare.com/client/v4"

export interface CnameArgs {
  token: string; zoneId: string; name: string; content: string
}

export async function upsertCnameRecord(a: CnameArgs): Promise<void> {
  const list = await mgmtFetch<{ result: Array<{ id: string; name: string }> }>(
    `${API}/zones/${a.zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(a.name)}`,
    { method: "GET", token: a.token, label: "upsertCnameRecord:list" },
  )
  const existing = list.result?.[0]
  const body = {
    type: "CNAME",
    name: a.name,
    content: a.content,
    ttl: 1,
    proxied: false,
  }
  if (existing) {
    await mgmtFetch(`${API}/zones/${a.zoneId}/dns_records/${existing.id}`, {
      method: "PATCH", token: a.token, label: "upsertCnameRecord:patch", body,
    })
  } else {
    await mgmtFetch(`${API}/zones/${a.zoneId}/dns_records`, {
      method: "POST", token: a.token, label: "upsertCnameRecord:create", body,
    })
  }
}
