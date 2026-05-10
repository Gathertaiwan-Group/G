import { z } from "zod"
import type { TenantContext } from "../lib/auth"

export const name = "list_products"
export const description =
  "Read-only. Returns products for this tenant's storefront. Sorted by created_at descending."

export const inputSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100).optional(),
})

interface ProductRow {
  id: string
  slug: string
  name: string
  price: number
  in_stock: boolean
}

export async function handler(input: z.infer<typeof inputSchema>, ctx: TenantContext): Promise<ProductRow[]> {
  const limit = input.limit ?? 100

  const { data, error } = await ctx.supabase
    .from("products")
    .select("id, slug, name, price, in_stock")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(`DB error: ${error.message}`)

  return (data ?? []) as ProductRow[]
}
