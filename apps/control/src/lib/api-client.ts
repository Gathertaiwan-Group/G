const API_URL = process.env.RAILWAY_API_URL ?? "http://localhost:4000"
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? ""

export async function apiClient<T>(
  path: string,
  options: RequestInit & { token?: string; internal?: boolean } = {}
): Promise<T> {
  const { token, internal, ...fetchOptions } = options
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(internal && { "X-Internal-Secret": INTERNAL_SECRET }),
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers: { ...headers, ...(fetchOptions.headers as Record<string, string>) },
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(error.message ?? `API error ${res.status}`)
  }
  return res.json() as Promise<T>
}
