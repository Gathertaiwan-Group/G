import Link from "next/link"

export function Nav() {
  return (
    <nav className="border-b px-6 py-3 flex gap-4 text-sm">
      <Link href="/">Overview</Link>
      <Link href="/tenants">Tenants</Link>
      <Link href="/jobs">Jobs</Link>
      <Link href="/audit">Audit</Link>
    </nav>
  )
}
