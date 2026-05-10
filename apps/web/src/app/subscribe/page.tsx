import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { gateModule } from "@repo/modules"
import { createClient } from "@/lib/supabase/server"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

async function getSubscriptionPlans() {
  try {
    const res = await fetch(`${API_URL}/subscription-plans`, { next: { revalidate: 300 } })
    if (!res.ok) return []
    const json = await res.json()
    return json.data ?? []
  } catch { return [] }
}

export const metadata = {
  title: "訂閱方案",
  description: "誠真生活定期訂閱方案，每月自動補貨享優惠，輕鬆維持健康好習慣。",
}

export default async function SubscribePage() {
  await gateModule(await createClient(), "subscriptions")
  const plans = await getSubscriptionPlans()

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-[#10305a] mb-3">定期訂閱方案</h1>
        <p className="text-zinc-500">每月自動補貨，無需擔心斷貨</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
        {plans.length === 0 && <p className="col-span-3 text-center text-zinc-400">方案暫未開放</p>}
        {plans.map((plan: any) => (
          <Card key={plan.id} className="flex flex-col rounded-[10px] border-zinc-200 hover:shadow-md transition-shadow">
            <CardHeader>
              <Badge variant="secondary" className="w-fit mb-2">{plan.interval === "monthly" ? "每月" : "每雙月"}</Badge>
              <CardTitle className="text-[#10305a]">{plan.name}</CardTitle>
              <CardDescription className="text-lg font-semibold">
                NT${Number(plan.price).toLocaleString()} <span className="text-sm font-normal">/ 期</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              {plan.benefits && Array.isArray(plan.benefits) && (
                <ul className="space-y-1.5 text-sm text-zinc-600">
                  {plan.benefits.map((b: any, i: number) => (
                    <li key={b.label ?? i} className="flex items-start gap-1.5">
                      <span className="text-[#10305a] mt-0.5">✓</span>
                      <span>{b.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
            <CardFooter>
              <Link href={`/subscribe/${plan.id}`} className="w-full">
                <Button className="w-full rounded-[10px] bg-[#10305a] hover:bg-[#1a4070]">選擇此方案</Button>
              </Link>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
