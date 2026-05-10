import type { Metadata } from "next"
import { Toaster } from "@/components/ui/sonner"
import { StorefrontShell } from "@/components/layout/StorefrontShell"
import { getBrand } from "@/lib/content"
import "./globals.css"

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand()
  // Defensive fallbacks: even though `getBrand()` is guaranteed to return a
  // valid Brand, keep literals here so a future regression cannot produce
  // empty <title> tags or undefined Open Graph values on the live storefront.
  const name = brand.name || "誠真生活 RealReal"
  const tagline = brand.tagline || "純淨植物力，為你的健康加分"
  const title = `${name} | ${tagline}`
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc"),
    title: { default: title, template: `%s | ${name}` },
    description: tagline || name,
    icons: { icon: brand.favicon_url || "/favicon.ico" },
    openGraph: {
      type: "website",
      locale: "zh_TW",
      siteName: name,
      title,
      description: tagline || name,
    },
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="font-sans antialiased">
        <StorefrontShell>{children}</StorefrontShell>
        <Toaster />
      </body>
    </html>
  )
}
