import { Skeleton } from "@/components/ui/skeleton"

export function ProductCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Image placeholder matching aspect-[4/5] */}
      <Skeleton className="aspect-[4/5] rounded-none" />

      {/* Content matching ProductCard's CardContent layout */}
      <div className="p-3 space-y-1.5">
        {/* Product name - two lines */}
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        {/* Price */}
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  )
}
