"use client"

import { usePathname } from "next/navigation"
import type { Brand } from "@repo/theme"
import { Header } from "./Header"
import { Footer } from "./Footer"

export function StorefrontChrome({
  brand,
  children,
}: {
  brand: Brand
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isAdmin = pathname.startsWith("/admin")

  if (isAdmin) {
    return <>{children}</>
  }

  return (
    <>
      <Header brand={brand} />
      <main className="min-h-[calc(100vh-4rem)]">{children}</main>
      <Footer brand={brand} />
    </>
  )
}
