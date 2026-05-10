"use client"
import { useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import Image from "next/image"

interface ProductImageUploadProps {
  value: string[]
  onChange: (urls: string[]) => void
}

export function ProductImageUpload({ value, onChange }: ProductImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError("檔案大小不能超過 5MB"); return }
    if (!file.type.startsWith("image/")) { setError("只接受圖片檔案"); return }

    setUploading(true)
    setError(null)
    const ext = file.name.split(".").pop()
    const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(path, file)

    if (uploadError) { setError(uploadError.message); setUploading(false); return }

    const { data: { publicUrl } } = supabase.storage.from("product-images").getPublicUrl(path)
    onChange([...value, publicUrl])
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  function removeImage(url: string) {
    onChange(value.filter(u => u !== url))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {value.map(url => (
          <div key={url} className="relative w-20 h-20 border rounded overflow-hidden group">
            <Image src={url} alt="" fill className="object-cover" />
            <button
              type="button"
              onClick={() => removeImage(url)}
              className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs transition-opacity"
            >刪除</button>
          </div>
        ))}
      </div>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
        {uploading ? "上傳中..." : "上傳圖片"}
      </Button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
