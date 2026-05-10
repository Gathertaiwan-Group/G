import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ReviewsTable } from "./_client"
import { gateModule } from "@repo/modules"

export const metadata = { title: "評價管理 | Admin" }

type Review = {
  id: string
  product_id: string
  rating: number
  content: string
  author_name: string
  author_email: string
  is_approved: boolean
  created_at: string
  products: { name: string } | null
}

export default async function AdminReviewsPage() {
  const supabase = await createClient()
  await gateModule(supabase, "product_reviews")
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login?redirect=/admin/reviews")

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()

  if (!profile || !["admin", "editor"].includes(profile.role)) redirect("/")

  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token ?? ""

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

  let reviews: Review[] = []
  let total = 0
  try {
    const res = await fetch(`${API_URL}/admin/reviews`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (res.ok) {
      const json = await res.json()
      reviews = json.data ?? []
      total = json.pagination?.total ?? reviews.length
    }
  } catch {
    // API unavailable
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#10305a]">評價管理</h1>
        <span className="text-sm text-[#687279]">共 {total} 則評價</span>
      </div>

      <ReviewsTable reviews={reviews} token={token} />
    </div>
  )
}
