import type { Metadata } from "next"
import { getBrand } from "@/lib/content"

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand()
  const name = brand.name || "誠真生活 RealReal"
  return {
    title: "註冊",
    description: `建立${name}帳號，享受純素健康食品購物體驗。`,
  }
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children
}
