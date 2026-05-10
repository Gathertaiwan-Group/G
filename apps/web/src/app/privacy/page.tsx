import type { Metadata } from "next"
import { getBrand, getSiteContent } from "@/lib/content"

// TODO Phase v1.5: move legal body to site_contents.privacy per tenant.
// Today this is realreal-specific legal copy; tenants override via admin UI.

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand()
  const name = brand.name || "誠真生活 RealReal"
  return {
    title: `隱私權政策 | ${name}`,
    description: `${name}隱私權政策，說明我們如何蒐集、使用及保護您的個人資料。`,
  }
}

type PrivacyContent = {
  content_html: string
  updated_at?: string
}

const fallbackPrivacyHtml = `
<h5 style="text-align:center;"><strong>適用範圍</strong> Scope of Policy</h5>

<p>本隱私權保護政策適用於誠真生活網站、官網購物平台及官方 LINE、客服信箱所蒐集的個人資料。<br/>
This Privacy Policy applies to personal data collected through the Cheng Zhen Living website, online store, official LINE, and customer service email.</p>

<h5 style="text-align:center;">資料蒐集與使用 Data Collection &amp; Use</h5>

<p>為完成訂單、提供客服與會員服務，誠真生活將蒐集必要的個人資料（如姓名、聯絡方式、收件資訊）。<br/>
To process orders and provide customer and membership services, RealReal Living collects necessary personal information (such as name, contact details, and shipping information).</p>

<p>個人資料僅用於<strong>訂單處理、會員管理、服務通知與品牌相關溝通</strong>。<br/>
Personal data is used solely for order processing, membership management, service notifications, and brand-related communications.</p>

<h5 style="text-align:center;">資料保護 Data Protection</h5>

<p>誠真生活將採取合理之安全措施，保護你的個人資料不被未經授權存取、使用或洩漏。<br/>
RealReal Living implements reasonable security measures to protect your personal data from unauthorized access, use, or disclosure.</p>

<h5 style="text-align:center;">資料分享 Data Sharing</h5>

<p>除法律規定或完成訂單所必要（如物流、金流服務）外，誠真生活<strong>不會向第三方揭露、出售或交換你的個人資料</strong>。<br/>
Except as required by law or necessary to fulfill orders (e.g., logistics and payment services), RealReal Living does not sell, trade, or disclose personal data to third parties.</p>

<h5 style="text-align:center;">使用者權利 Your Rights</h5>

<p>你可依法查詢、更正或請求停止使用你的個人資料。<br/>
You have the right to access, correct, or request cessation of the use of your personal data in accordance with applicable laws.</p>

<h5 style="text-align:center;">條款更新 Policy Updates</h5>

<p>本隱私權條款如有調整，將公布於官網，不另行個別通知。<br/>
Any updates to this Privacy Policy will be posted on the website without individual notice.</p>
`

export default async function PrivacyPage() {
  const content = await getSiteContent<PrivacyContent>("privacy_policy")
  const hasCustomContent =
    content?.content_html && content.content_html.trim().length > 0

  const updatedDate = content?.updated_at
    ? new Date(content.updated_at).toLocaleDateString("zh-TW", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "2025 年 1 月 1 日"

  if (hasCustomContent) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2 text-center text-[#10305a]">隱私權政策</h1>
        <p className="text-[#687279] text-center mb-10">
          最後更新日期：{updatedDate}
        </p>
        <div
          className="prose prose-zinc max-w-none
            prose-headings:text-[#10305a] prose-headings:font-bold
            prose-p:text-[#687279] prose-p:leading-relaxed
            prose-a:text-[#10305a] prose-a:underline
            prose-img:rounded-[10px]
            prose-li:text-[#687279]
            prose-blockquote:border-[#10305a]/30 prose-blockquote:text-[#687279]
            prose-strong:text-[#10305a]"
          dangerouslySetInnerHTML={{ __html: content!.content_html! }}
        />
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2 text-center text-[#10305a]">隱私權政策</h1>
      <p className="text-[#687279] text-center mb-10">
        最後更新日期：{updatedDate}
      </p>

      <div
        className="prose prose-headings:text-[#10305a] prose-p:text-[#687279] prose-strong:text-[#10305a] prose-h5:text-xl prose-h5:font-semibold prose-h5:mt-10 prose-h5:mb-4 prose-p:leading-relaxed max-w-none"
        dangerouslySetInnerHTML={{ __html: fallbackPrivacyHtml }}
      />
    </div>
  )
}
