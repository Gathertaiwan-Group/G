import Link from "next/link"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"
import { parseTenantFilter, TENANT_STATUSES } from "@/lib/tenant-filter"

export const metadata = { title: "Tenants | Platform Control" }

export default async function TenantsPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requirePlatformUser()
  const f = parseTenantFilter(await searchParams)
  const supabase = await createControlClient()

  let q = supabase.from("tenants")
    .select("id, slug, custom_domain, status, created_at, activated_at")
    .order("created_at", { ascending: false }).limit(200)
  if (f.status) q = q.eq("status", f.status)
  if (f.q) q = q.ilike("slug", `%${f.q}%`)
  const { data } = await q

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Tenants</h1>
      <form method="get" className="flex gap-2 text-sm">
        <select name="status" defaultValue={f.status ?? ""} className="border rounded px-2 py-1">
          <option value="">all statuses</option>
          {TENANT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input name="q" defaultValue={f.q} placeholder="slug…"
          className="border rounded px-2 py-1" />
        <button className="border rounded px-3 py-1">Filter</button>
      </form>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">Slug</th><th>Domain</th><th>Status</th><th>Created</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map(t => (
            <tr key={t.id} className="border-t">
              <td className="py-2">
                <Link className="underline" href={`/tenants/${t.id}`}>{t.slug}</Link>
              </td>
              <td>{t.custom_domain ?? "—"}</td>
              <td className={statusColor(t.status)}>{t.status}</td>
              <td>{fmtDate(t.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
