import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"

export const metadata = { title: "Jobs | Platform Control" }

export default async function JobsPage() {
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data } = await supabase.from("provisioning_jobs")
    .select("id, tenant_id, step, status, attempt, last_error, created_at")
    .order("created_at", { ascending: false }).limit(200)

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Provisioning jobs</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="py-2">Created</th><th>Tenant</th><th>Step</th><th>Status</th><th>Attempt</th><th>Error</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map(j => (
            <tr key={j.id} className="border-t align-top">
              <td className="py-2">{fmtDate(j.created_at)}</td>
              <td className="font-mono text-xs">{j.tenant_id?.slice(0, 8)}</td>
              <td>{j.step}</td>
              <td className={statusColor(j.status)}>{j.status}</td>
              <td>{j.attempt}</td>
              <td className="max-w-xs truncate text-red-600" title={j.last_error ?? ""}>{j.last_error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
