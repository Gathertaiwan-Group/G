import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import PaymentConfigForm from "./_components/payment-config-form"

export const metadata = { title: "金流設定 | Admin" }

export default function PaymentSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">金流 / 物流 / 發票設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          這些金鑰會即時生效（5 分鐘內）。資料存在 DB（site_contents.payment_config）
          ，並覆蓋 Railway 上的 env 變數。空白欄位代表「不變更」，要清空請填 <code>__CLEAR__</code>。
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">PChomePay</CardTitle></CardHeader>
        <CardContent><PaymentConfigForm provider="pchomepay" /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">LINE Pay</CardTitle></CardHeader>
        <CardContent><PaymentConfigForm provider="linepay" /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">JKOPay 街口</CardTitle></CardHeader>
        <CardContent><PaymentConfigForm provider="jkopay" /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">ECPay 綠界（金流 + 物流）</CardTitle></CardHeader>
        <CardContent><PaymentConfigForm provider="ecpay" /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Amego 電子發票</CardTitle></CardHeader>
        <CardContent><PaymentConfigForm provider="amego" /></CardContent>
      </Card>
    </div>
  )
}
