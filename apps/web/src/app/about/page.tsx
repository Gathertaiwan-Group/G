import type { Metadata } from "next"
import { getSiteContent, getBrand } from "@/lib/content"

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand()
  const name = brand.name || "誠真生活 RealReal"
  return {
    title: `品牌故事 | ${name}`,
    description:
      "誠真生活是台灣在地的純素保健食品品牌，堅持以純淨原料與科學配方，為您帶來誠真健康。",
  }
}

type AboutContent = {
  content_html?: string
}

const wpContent = `
<img
  width="865"
  height="1024"
  src="https://realreal.cc/wp-content/uploads/2025/09/reallightjpeg-865x1024.webp"
  alt="誠真生活品牌故事"
  srcset="https://realreal.cc/wp-content/uploads/2025/09/reallightjpeg-865x1024.webp 865w, https://realreal.cc/wp-content/uploads/2025/09/reallightjpeg-253x300.webp 253w, https://realreal.cc/wp-content/uploads/2025/09/reallightjpeg-768x909.webp 768w, https://realreal.cc/wp-content/uploads/2025/09/reallightjpeg-750x888.webp 750w, https://realreal.cc/wp-content/uploads/2025/09/reallightjpeg-600x710.webp 600w, https://realreal.cc/wp-content/uploads/2025/09/reallightjpeg.webp 936w"
  sizes="(max-width: 865px) 100vw, 865px"
/>

<h2>品牌故事 Our Story</h2>

<p><b>像孩子般純真，讓世界更美好</b></p>
<p>從小看著爸爸與免疫病變和癌症共存，他依然樂觀，總提醒我：「世界上還有許多比我們更需要幫助的人」。</p>
<p>我幸運地靠著獎學金完成學業，心中滿懷感恩，更希望能將這份善意回饋社會。</p>
<p>從工作之餘，經營分享滋養身心資訊的社群媒體開始，聚集眾人之力，並將收益捐助給更需要幫助的人。</p>
<p>我相信，每個人都能多付出一些，成為彼此生命中的溫柔光亮。</p>
<p>我相信，這正是我們最純粹的模樣——像孩子般，樂善好施，自在純真。</p>
<p><strong>創辦人 尹昕</strong></p>

<p><b>Pure as a child, making the world a better place</b></p>
<p>Inspired by my father's fight life alongside autoimmune disease and cancer, I carry forward his reminder: <i>"There are always people who need help more than we do".</i></p>
<p>Blessed to have completed my studies through scholarships, I started giving back—sharing wellness on Instagram and turning its proceeds into support for those who need it most.</p>
<p>I believe that each of us can give a little more, becoming a gentle light in one another's lives.</p>
<p>I believe this is our truest nature, like a child—kind, joyful, free, and pure.</p>
<p><b>Yin Hsin, Founder</b></p>

<h2>品牌願景 Our Vision</h2>
<p>每個人都能活得像個孩子，樂善好施，自在純真。</p>
<p>Everyone can live like a child—kind, joyful, free, and pure.</p>

<img
  width="1024"
  height="683"
  src="https://realreal.cc/wp-content/uploads/2025/09/AdobeStock_365765933-1024x683.webp"
  alt="誠真生活品牌願景"
  srcset="https://realreal.cc/wp-content/uploads/2025/09/AdobeStock_365765933-1024x683.webp 1024w, https://realreal.cc/wp-content/uploads/2025/09/AdobeStock_365765933-300x200.webp 300w, https://realreal.cc/wp-content/uploads/2025/09/AdobeStock_365765933-768x512.webp 768w, https://realreal.cc/wp-content/uploads/2025/09/AdobeStock_365765933-1536x1024.webp 1536w, https://realreal.cc/wp-content/uploads/2025/09/AdobeStock_365765933-2048x1365.webp 2048w, https://realreal.cc/wp-content/uploads/2025/09/AdobeStock_365765933-750x500.webp 750w, https://realreal.cc/wp-content/uploads/2025/09/AdobeStock_365765933-600x400.webp 600w"
  sizes="(max-width: 1024px) 100vw, 1024px"
/>

<h2>品牌使命 Our Mission</h2>
<p>滋養每個人的童心與純真，喚醒內在的善念與喜悅，讓身心回歸自在與健康。</p>
<p>To nurture innocence and purity, awaken kindness and joy within, and bring body and mind back to ease and vitality.</p>

<h2>品牌目標 Our Goal</h2>
<p>提供滋養身心的食物、資訊與用品。</p>
<p>將日常支出，化成支持弱勢的資糧。</p>
<p>讓健康成為關懷與慈悲的生活方式。</p>
<p>Providing nourishing food, knowledge, and essentials for body and soul.</p>
<p>Transforming daily spending into resources that support the vulnerable.</p>
<p>Making health a way of living—rooted in care and compassion.</p>

<h2>品牌承諾 Our Promises</h2>
<p>合作工廠通過HACCP及ISO22000品質認證</p>
<p>產品經第三方檢驗機構品質把關</p>
<p>商品投保產品責任險</p>
<p>Made in HACCP &amp; ISO 22000 certified factories</p>
<p>Quality tested by independent labs</p>
<p>Covered by product liability insurance</p>
`

export default async function AboutPage() {
  const content = await getSiteContent<AboutContent>("about_page")
  const hasCustomContent = content?.content_html && content.content_html.trim().length > 0

  const htmlContent = hasCustomContent ? content!.content_html! : wpContent

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8 text-[#10305a] text-center">品牌故事</h1>
      <div
        className="prose prose-zinc max-w-none
          prose-headings:text-[#10305a] prose-headings:font-bold
          prose-p:text-[#687279] prose-p:leading-relaxed
          prose-a:text-[#10305a] prose-a:underline
          prose-img:rounded-[10px] prose-img:mx-auto
          prose-li:text-[#687279]
          prose-blockquote:border-[#10305a]/30 prose-blockquote:text-[#687279]
          prose-strong:text-[#10305a]
          prose-b:text-[#10305a]
          prose-i:text-[#687279]"
        style={{ textAlign: "center" }}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  )
}
