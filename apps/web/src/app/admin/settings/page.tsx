import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import SiteNoticeForm from "./_components/site-notice-form"

export const metadata = { title: "系統設定 | Admin" }

export default async function AdminSettingsPage() {
  const supabase = await createClient()

  const { data: siteNoticeSetting } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "site_notice")
    .maybeSingle()

  const siteNotice = siteNoticeSetting?.value as {
    message: string
    active: boolean
    variant: "info" | "warning" | "success"
  } | null

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">系統設定</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">站台公告橫幅</CardTitle>
        </CardHeader>
        <CardContent>
          <SiteNoticeForm
            message={siteNotice?.message ?? ""}
            active={siteNotice?.active ?? false}
            variant={siteNotice?.variant ?? "info"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">金流 / 物流 / 發票金鑰</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-2">
            管理 PChomePay、LINE Pay、JKOPay、ECPay、Amego 的 API 金鑰。
          </p>
          <Link href="/admin/settings/payments" className="text-sm underline">
            前往設定 →
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
