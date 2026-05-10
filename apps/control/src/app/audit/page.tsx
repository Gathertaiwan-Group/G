import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate } from "@/lib/format"

export const metadata = { title: "Audit | Platform Control" }

export default async function AuditPage() {
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data } = await supabase.from("audit_log")
    .select("created_at, tenant_id, actor_type, actor_id, action, resource")
    .order("created_at", { ascending: false }).limit(500)

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">Time</th><th>Actor</th><th>Tenant</th><th>Action</th><th>Resource</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((e, i) => (
            <tr key={i} className="border-t">
              <td className="py-2">{fmtDate(e.created_at)}</td>
              <td className="text-xs">{e.actor_type}{e.actor_id ? `:${e.actor_id}` : ""}</td>
              <td className="font-mono text-xs">{e.tenant_id?.slice(0, 8) ?? "—"}</td>
              <td>{e.action}</td>
              <td className="text-xs">{e.resource ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
