import { notFound } from "next/navigation"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"
import { retryProvisioningStep } from "./actions"

export default async function ProvisionPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data: tenant } = await supabase.from("tenants")
    .select("id, slug, status").eq("id", id).maybeSingle()
  if (!tenant) notFound()
  const { data: jobs } = await supabase.from("provisioning_jobs")
    .select("step, status, attempt, last_error, started_at, finished_at")
    .eq("tenant_id", id).order("created_at")

  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">{tenant.slug} — provisioning</h1>
      <p className={`text-sm ${statusColor(tenant.status)}`}>{tenant.status}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1">Step</th><th>Status</th><th>Attempt</th>
            <th>Finished</th><th>Error</th><th></th>
          </tr>
        </thead>
        <tbody>
          {(jobs ?? []).map(j => (
            <tr key={j.step} className="border-t align-top">
              <td className="py-1">{j.step}</td>
              <td className={statusColor(j.status)}>{j.status}</td>
              <td>{j.attempt}</td>
              <td>{fmtDate(j.finished_at)}</td>
              <td className="max-w-xs truncate text-red-600" title={j.last_error ?? ""}>
                {j.last_error ?? ""}
              </td>
              <td>
                {j.status === "failed" && (
                  <form action={retryProvisioningStep}>
                    <input type="hidden" name="tenantId" value={id} />
                    <input type="hidden" name="step" value={j.step} />
                    <button className="border rounded px-2 py-0.5">
                      Retry from this step
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
