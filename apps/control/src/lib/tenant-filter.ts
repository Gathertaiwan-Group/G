export const TENANT_STATUSES = [
  "pending_payment", "provisioning", "active", "suspended", "canceled", "failed",
] as const
export type TenantStatus = (typeof TENANT_STATUSES)[number]

export interface TenantFilter {
  status: TenantStatus | null
  q: string
}

// searchParams values arrive as string | string[] | undefined
export function parseTenantFilter(
  sp: Record<string, string | string[] | undefined>,
): TenantFilter {
  const rawStatus = Array.isArray(sp.status) ? sp.status[0] : sp.status
  const rawQ = Array.isArray(sp.q) ? sp.q[0] : sp.q
  const status = (TENANT_STATUSES as readonly string[]).includes(rawStatus ?? "")
    ? (rawStatus as TenantStatus)
    : null
  return { status, q: (rawQ ?? "").trim().toLowerCase() }
}
