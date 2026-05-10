import type { Metadata } from "next"
import { getBrand } from "@/lib/content"

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand()
  const name = brand.name || "誠真生活 RealReal"
  return {
    title: "登入",
    description: `登入您的${name}帳號，管理訂單與訂閱。`,
  }
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
