import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"

export const metadata = { title: "Billing | Platform Control" }

// Spec §4 nine-page set: read-only billing_subscriptions view. Auth-gated:
// requirePlatformUser() runs before any control-DB access.
export default async function BillingPage() {
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data } = await supabase
    .from("billing_subscriptions")
    .select("id, tenant_id, status, plan, current_period_end, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200)

  const rows = data ?? []

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Billing</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2">Subscription</th>
              <th>Tenant</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Period end</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="py-2 font-mono text-xs">{s.id}</td>
                <td className="font-mono text-xs">{s.tenant_id?.slice(0, 8) ?? "—"}</td>
                <td>{s.plan ?? "—"}</td>
                <td className={statusColor(s.status ?? "")}>{s.status ?? "—"}</td>
                <td>{fmtDate(s.current_period_end)}</td>
                <td>{fmtDate(s.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
