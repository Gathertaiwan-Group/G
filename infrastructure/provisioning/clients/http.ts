export interface MgmtOpts {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  token: string
  label: string
  body?: unknown
  timeoutMs?: number
  headers?: Record<string, string>
}

export async function mgmtFetch<T = unknown>(url: string, o: MgmtOpts): Promise<T> {
  const res = await fetch(url, {
    method: o.method,
    headers: {
      Authorization: `Bearer ${o.token}`,
      "Content-Type": "application/json",
      "User-Agent": "provisioning/1.0",
      ...(o.headers ?? {}),
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
  })
  if (!res.ok) {
    throw new Error(`${o.label}: ${res.status} ${await res.text()}`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
