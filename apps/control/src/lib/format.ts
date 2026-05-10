export function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  })
}

export function statusColor(status: string): string {
  return {
    active: "text-green-600",
    provisioning: "text-blue-600",
    pending_payment: "text-yellow-600",
    failed: "text-red-600",
    canceled: "text-gray-500",
    suspended: "text-orange-600",
  }[status] ?? "text-foreground"
}
