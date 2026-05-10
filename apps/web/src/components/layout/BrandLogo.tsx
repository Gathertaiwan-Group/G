import Image from "next/image"
import { getBrand } from "@/lib/content"

/**
 * Server Component that renders the tenant logo using the active brand from
 * `site_contents.brand`. Keeps literal fallbacks ("/logo.svg" + the realreal
 * brand name) so the storefront stays visually intact even if the row is
 * missing or invalid.
 */
export async function BrandLogo({
  width = 150,
  height = 75,
  className,
}: {
  width?: number
  height?: number
  className?: string
}) {
  const brand = await getBrand()
  const src = brand.logo_url || "/logo.svg"
  const alt = brand.name || "誠真生活 RealReal"
  return <Image src={src} alt={alt} width={width} height={height} className={className} />
}
