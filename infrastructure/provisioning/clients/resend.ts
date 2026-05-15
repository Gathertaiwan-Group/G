import { mgmtFetch } from "./http"

const API = "https://api.resend.com"

export interface DnsRecord { type: string; name: string; value: string }

interface RawRecord { record?: string; type: string; name: string; value: string }

function mapRecords(records: RawRecord[] | undefined): DnsRecord[] {
  return (records ?? []).map(r => ({ type: r.type, name: r.name, value: r.value }))
}

export async function addResendDomain(
  apiKey: string, name: string,
): Promise<{ id: string; records: DnsRecord[] }> {
  const r = await mgmtFetch<{ id: string; records?: RawRecord[] }>(`${API}/domains`, {
    method: "POST", token: apiKey, label: "addResendDomain", body: { name },
  })
  return { id: r.id, records: mapRecords(r.records) }
}

export async function getResendDnsRecords(
  apiKey: string, domainId: string,
): Promise<DnsRecord[]> {
  const r = await mgmtFetch<{ records?: RawRecord[] }>(`${API}/domains/${domainId}`, {
    method: "GET", token: apiKey, label: "getResendDnsRecords",
  })
  return mapRecords(r.records)
}

export async function pollResendVerified(
  apiKey: string, domainId: string, o: { intervalMs?: number; maxMs?: number } = {},
): Promise<boolean> {
  const interval = o.intervalMs ?? 10_000
  const deadline = Date.now() + (o.maxMs ?? 300_000)
  for (;;) {
    const r = await mgmtFetch<{ status: string }>(`${API}/domains/${domainId}`, {
      method: "GET", token: apiKey, label: "pollResendVerified",
    })
    if (r.status === "verified") return true
    if (r.status === "failure") return false
    if (Date.now() > deadline) throw new Error(`pollResendVerified: timed out (last=${r.status})`)
    await new Promise(res => setTimeout(res, interval))
  }
}
