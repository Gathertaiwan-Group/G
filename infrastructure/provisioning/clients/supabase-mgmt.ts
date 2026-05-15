import { mgmtFetch } from "./http"

const API = "https://api.supabase.com/v1"

export interface CreateProjectArgs {
  pat: string; name: string; region: string; orgId: string; dbPass: string
}
export async function createSupabaseProject(a: CreateProjectArgs): Promise<{ ref: string; url: string }> {
  const r = await mgmtFetch<{ id: string; endpoint?: string }>(`${API}/projects`, {
    method: "POST", token: a.pat, label: "createSupabaseProject",
    body: { name: a.name, region: a.region, organization_id: a.orgId, db_pass: a.dbPass, plan: "free" },
  })
  return { ref: r.id, url: r.endpoint ?? `https://${r.id}.supabase.co` }
}

export async function pollProjectHealthy(
  pat: string, ref: string, o: { intervalMs?: number; maxMs?: number } = {},
): Promise<void> {
  const interval = o.intervalMs ?? 5_000
  const deadline = Date.now() + (o.maxMs ?? 180_000)
  for (;;) {
    const p = await mgmtFetch<{ status: string }>(`${API}/projects/${ref}`, {
      method: "GET", token: pat, label: "pollProjectHealthy",
    })
    if (p.status === "ACTIVE_HEALTHY") return
    if (Date.now() > deadline) throw new Error(`pollProjectHealthy: timed out (last=${p.status})`)
    await new Promise(r => setTimeout(r, interval))
  }
}

export async function runTenantSql<T = unknown>(
  pat: string, ref: string, query: string, label: string,
): Promise<T> {
  return mgmtFetch<T>(`${API}/projects/${ref}/database/query`, {
    method: "POST", token: pat, label, body: { query },
  })
}

export async function fetchProjectApiKeys(
  pat: string, ref: string,
): Promise<{ anon: string; serviceRole: string }> {
  const keys = await mgmtFetch<Array<{ name: string; api_key: string }>>(
    `${API}/projects/${ref}/api-keys`, { method: "GET", token: pat, label: "fetchProjectApiKeys" },
  )
  const anon = keys.find(k => k.name === "anon")?.api_key
  const serviceRole = keys.find(k => k.name === "service_role")?.api_key
  if (!anon || !serviceRole) throw new Error("fetchProjectApiKeys: missing anon/service_role")
  return { anon, serviceRole }
}

export async function configureAuth(
  pat: string, ref: string, siteUrl: string, redirectUrls: string[],
): Promise<void> {
  await mgmtFetch(`${API}/projects/${ref}/config/auth`, {
    method: "PATCH", token: pat, label: "configureAuth",
    body: {
      site_url: siteUrl,
      uri_allow_list: redirectUrls.join(","),
      mailer_autoconfirm: false,
    },
  })
}

export async function createStorageBuckets(pat: string, ref: string): Promise<void> {
  // Buckets via SQL against storage.buckets (idempotent on conflict). Spec §5.
  const sql = `
insert into storage.buckets (id, name, public) values
 ('product-images','product-images',true),
 ('branding','branding',true),
 ('posts-media','posts-media',true),
 ('course-content','course-content',false)
on conflict (id) do nothing;`
  await runTenantSql(pat, ref, sql, "createStorageBuckets")
}
