import { getBrand } from "@/lib/content"
import { StorefrontChrome } from "./StorefrontChrome"

export async function StorefrontShell({ children }: { children: React.ReactNode }) {
  const brand = await getBrand()
  return <StorefrontChrome brand={brand}>{children}</StorefrontChrome>
}
