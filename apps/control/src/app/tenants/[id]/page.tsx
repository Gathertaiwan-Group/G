import Link from "next/link"
import { notFound } from "next/navigation"
import { requirePlatformUser } from "@/lib/auth"
import { createControlClient } from "@/lib/control-db"
import { fmtDate, statusColor } from "@/lib/format"
import { RotateToken } from "./token/RotateToken"

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePlatformUser()
  const supabase = await createControlClient()

  const { data: tenant } = await supabase.from("tenants").select("*").eq("id", id).maybeSingle()
  if (!tenant) notFound()

  const [{ data: infra }, { data: modules }, { data: recentJobs }, { data: recentHealth }] = await Promise.all([
    supabase.from("tenant_infrastructure")
      .select("vercel_deployment_url, railway_api_url, railway_mcp_url, supabase_project_ref, resend_dkim_verified_at")
      .eq("tenant_id", id).maybeSingle(),
    supabase.from("tenant_modules")
      .select("module, enabled, enabled_at").eq("tenant_id", id).order("module"),
    supabase.from("provisioning_jobs")
      .select("step, status, attempt, last_error, created_at, finished_at")
      .eq("tenant_id", id).order("created_at", { ascending: false }).limit(10),
    supabase.from("tenant_health_log")
      .select("checked_at, vercel_ok, api_ok, mcp_ok, supabase_ok")
      .eq("tenant_id", id).order("checked_at", { ascending: false }).limit(20),
  ])

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-xl font-semibold">{tenant.slug}</h1>
      <p className={`text-sm ${statusColor(tenant.status)}`}>{tenant.status}</p>
      <Link href={`/tenants/${id}/audit`} className="text-sm underline">
        View audit log →
      </Link>

      <section>
        <h2 className="font-semibold mb-2">Infrastructure</h2>
        {infra ? (
          <ul className="text-sm space-y-1">
            <li>Vercel: {infra.vercel_deployment_url ?? "—"}</li>
            <li>Railway api: {infra.railway_api_url ?? "—"}</li>
            <li>Railway mcp: {infra.railway_mcp_url ?? "—"}</li>
            <li>Supabase ref: {infra.supabase_project_ref}</li>
            <li>Resend DKIM verified: {fmtDate(infra.resend_dkim_verified_at)}</li>
          </ul>
        ) : <p className="text-sm text-muted-foreground">No infrastructure record.</p>}
      </section>

      <section>
        <h2 className="font-semibold mb-2">Modules</h2>
        <ul className="text-sm grid grid-cols-2 gap-1">
          {(modules ?? []).map(m => (
            <li key={m.module}>{m.enabled ? "✓" : "○"} {m.module}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-2">MCP token</h2>
        {/* Spec §8 platform-admin rotation. Plaintext is shown exactly once
            in the client island below (never persisted/logged); incident
            response is docs/runbooks/mcp-token-leak.md (PR-E5). */}
        <RotateToken tenantId={id} />
      </section>

      <section>
        <h2 className="font-semibold mb-2">Recent provisioning jobs</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-1">Step</th><th>Status</th><th>Attempt</th><th>Created</th></tr>
          </thead>
          <tbody>
            {(recentJobs ?? []).map((j, i) => (
              <tr key={i} className="border-t">
                <td className="py-1">{j.step}</td>
                <td className={statusColor(j.status)}>{j.status}</td>
                <td>{j.attempt}</td>
                <td>{fmtDate(j.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Recent health (last 20)</h2>
        <ul className="text-xs flex flex-wrap gap-1">
          {(recentHealth ?? []).map((h, i) => {
            const ok = h.vercel_ok && h.api_ok && h.mcp_ok && h.supabase_ok
            return (
              <li key={i} title={fmtDate(h.checked_at)}
                  className={`w-3 h-3 rounded-sm ${ok ? "bg-green-500" : "bg-red-500"}`} />
            )
          })}
        </ul>
      </section>
    </main>
  )
}
