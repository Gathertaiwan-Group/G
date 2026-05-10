"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PaginationProps {
  total: number
  pageSize: number
  currentPage: number
}

export function Pagination({ total, pageSize, currentPage }: PaginationProps) {
  const router = useRouter()
  const sp = useSearchParams()
  const totalPages = Math.ceil(total / pageSize)

  if (totalPages <= 1) return null

  function goTo(page: number) {
    const params = new URLSearchParams(sp.toString())
    if (page <= 1) {
      params.delete("page")
    } else {
      params.set("page", String(page))
    }
    router.push(`/shop?${params.toString()}`)
  }

  // Generate page numbers to show
  const pages = generatePageNumbers(currentPage, totalPages)

  return (
    <nav className="flex items-center justify-center gap-1 mt-10" aria-label="分頁">
      <Button
        variant="outline"
        size="sm"
        disabled={currentPage <= 1}
        onClick={() => goTo(currentPage - 1)}
        className="px-3"
      >
        上一頁
      </Button>

      {pages.map((page, i) =>
        page === "..." ? (
          <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground text-sm">
            ...
          </span>
        ) : (
          <Button
            key={page}
            variant={page === currentPage ? "default" : "outline"}
            size="sm"
            onClick={() => goTo(page as number)}
            className={cn("w-9 px-0", page === currentPage && "pointer-events-none")}
          >
            {page}
          </Button>
        )
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={currentPage >= totalPages}
        onClick={() => goTo(currentPage + 1)}
        className="px-3"
      >
        下一頁
      </Button>
    </nav>
  )
}

function generatePageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const pages: (number | "...")[] = [1]

  if (current > 3) {
    pages.push("...")
  }

  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  for (let i = start; i <= end; i++) {
    pages.push(i)
  }

  if (current < total - 2) {
    pages.push("...")
  }

  pages.push(total)
  return pages
}
