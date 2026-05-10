import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"

export const metadata = { title: "Platform Control" }

export default async function HomePage() {
  await requirePlatformUser()
  const supabase = await createControlClient()

  const { count: tenantCount } = await supabase.from("tenants")
    .select("*", { count: "exact", head: true }).eq("status", "active")

  const { count: queuedJobs } = await supabase.from("provisioning_jobs")
    .select("*", { count: "exact", head: true }).eq("status", "queued")

  const { count: failedJobs } = await supabase.from("provisioning_jobs")
    .select("*", { count: "exact", head: true }).eq("status", "failed")

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Active tenants" value={tenantCount ?? 0} />
        <Stat label="Queued jobs" value={queuedJobs ?? 0} />
        <Stat label="Failed jobs" value={failedJobs ?? 0} colorIfNonZero="text-red-600" />
      </div>
    </main>
  )
}

function Stat({ label, value, colorIfNonZero }: { label: string; value: number; colorIfNonZero?: string }) {
  const color = colorIfNonZero && value > 0 ? colorIfNonZero : "text-foreground"
  return (
    <div className="border rounded p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  )
}
