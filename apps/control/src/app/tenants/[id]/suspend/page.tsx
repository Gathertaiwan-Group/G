import { notFound } from "next/navigation"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { statusColor } from "@/lib/format"
import { suspendTenantAction, resumeTenantAction } from "./actions"

export default async function SuspendPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  await requirePlatformUser()
  const supabase = await createControlClient()
  const { data: t } = await supabase.from("tenants")
    .select("id, slug, status, suspended_reason").eq("id", id).maybeSingle()
  if (!t) notFound()
  const suspended = t.status === "suspended"

  return (
    <main className="p-8 space-y-4 max-w-lg">
      <h1 className="text-xl font-semibold">{t.slug}</h1>
      <p className={`text-sm ${statusColor(t.status)}`}>{t.status}</p>
      {suspended ? (
        <form action={resumeTenantAction} className="space-y-2">
          <input type="hidden" name="tenantId" value={id} />
          <p className="text-sm text-muted-foreground">
            Reason on file: {t.suspended_reason ?? "—"}
          </p>
          <button className="border rounded px-3 py-1">Resume tenant</button>
        </form>
      ) : (
        <form action={suspendTenantAction} className="space-y-2">
          <input type="hidden" name="tenantId" value={id} />
          <textarea name="reason" required placeholder="suspension reason"
            className="border rounded w-full p-2 text-sm" />
          <button className="border rounded px-3 py-1 text-red-600">
            Suspend tenant
          </button>
        </form>
      )}
    </main>
  )
}
