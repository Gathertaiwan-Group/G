import { notFound } from "next/navigation"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { audit } from "@realreal/control-db"
import { fmtDate } from "@/lib/format"

// Spec §4 nine-page set: tenant-scoped audit_log. Auth-gated:
// requirePlatformUser() runs before any control-DB access. Reuses the merged
// control-db audit.listAuditForTenant helper (tenant-scoped, newest first).
export default async function TenantAuditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data: t } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", id)
    .maybeSingle()
  if (!t) notFound()

  const entries = (await audit.listAuditForTenant(supabase, id, 200)) as Array<{
    created_at: string | null
    actor_type: string
    actor_id: string | null
    action: string
    resource: string | null
  }>

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">{t.slug} — audit</h1>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit entries for this tenant.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2">Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Resource</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((a, i) => (
              <tr key={i} className="border-t">
                <td className="py-2">{fmtDate(a.created_at)}</td>
                <td>
                  {a.actor_type}
                  {a.actor_id ? ` (${a.actor_id})` : ""}
                </td>
                <td>{a.action}</td>
                <td>{a.resource ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
