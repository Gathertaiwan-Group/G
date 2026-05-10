"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

export function ReviewForm({ productId, token }: { productId: string; token: string }) {
  const [rating, setRating] = useState(5)
  const [content, setContent] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (content.length < 10) {
      setError("評價內容至少需要 10 個字元")
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch(`${API_URL}/products/${productId}/reviews`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ rating, content }),
        })
        if (!res.ok) {
          const json = await res.json()
          setError(json.error?.fieldErrors?.content?.[0] ?? json.error ?? "送出失敗，請稍後再試")
          return
        }
        setSuccess(true)
        setContent("")
        setRating(5)
        router.refresh()
      } catch {
        setError("送出失敗，請稍後再試")
      }
    })
  }

  if (success) {
    return (
      <div className="rounded-[10px] border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        感謝您的評價！
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[10px] border border-gray-200 p-4 space-y-4">
      <h3 className="text-base font-semibold" style={{ color: "#10305a" }}>撰寫評價</h3>

      {/* Star rating selector */}
      <div className="flex items-center gap-1">
        <span className="text-sm mr-2" style={{ color: "#687279" }}>評分：</span>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            className="text-2xl transition-colors"
            style={{ color: star <= rating ? "#f59e0b" : "#d1d5db" }}
            aria-label={`${star} 星`}
          >
            &#9733;
          </button>
        ))}
      </div>

      {/* Content textarea */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="分享您對這個商品的使用心得（至少 10 個字元）"
        rows={4}
        className="w-full rounded-[10px] border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#10305a]/20 focus:border-[#10305a]"
        style={{ color: "#687279" }}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-[10px] px-6 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
        style={{ backgroundColor: "#10305a" }}
      >
        {isPending ? "送出中..." : "送出評價"}
      </button>
    </form>
  )
}
