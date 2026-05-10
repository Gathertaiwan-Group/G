import Link from "next/link"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"

export const metadata = { title: "Tenants | Platform Control" }

export default async function TenantsPage() {
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data, error } = await supabase
    .from("tenants").select("id, slug, custom_domain, status, plan, created_at, activated_at")
    .order("created_at", { ascending: false })

  if (error) return <main className="p-8">Error: {error.message}</main>

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Tenants ({data?.length ?? 0})</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2">Slug</th><th>Domain</th><th>Status</th>
            <th>Plan</th><th>Activated</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map(t => (
            <tr key={t.id} className="border-t">
              <td className="py-2"><Link href={`/tenants/${t.id}`} className="underline">{t.slug}</Link></td>
              <td>{t.custom_domain ?? "—"}</td>
              <td className={statusColor(t.status)}>{t.status}</td>
              <td>{t.plan ?? "—"}</td>
              <td>{fmtDate(t.activated_at)}</td>
            </tr>
          ))}
          {(data ?? []).length === 0 && (
            <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No tenants yet.</td></tr>
          )}
        </tbody>
      </table>
    </main>
  )
}
