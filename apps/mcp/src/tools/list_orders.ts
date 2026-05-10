import { z } from "zod"
import type { TenantContext } from "../lib/auth"

export const name = "list_orders"
export const description =
  "Read-only. Returns recent orders for this tenant's storefront. Sorted by created_at descending."

export const inputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50).optional(),
  status: z.string().optional(),
})

interface OrderRow {
  id: string
  total: number
  status: string
  created_at: string
  customer_email: string | null
}

export async function handler(input: z.infer<typeof inputSchema>, ctx: TenantContext): Promise<OrderRow[]> {
  const limit = input.limit ?? 50

  let query = ctx.supabase
    .from("orders")
    .select("id, total, status, created_at, customer_email")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (input.status) {
    query = query.eq("status", input.status)
  }

  const { data, error } = await query
  if (error) throw new Error(`DB error: ${error.message}`)

  return (data ?? []) as OrderRow[]
}
