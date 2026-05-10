import { z } from "zod"
import { DEFAULT_BRAND, safeParseBrand, type Brand } from "@repo/theme"
import type { TenantContext } from "../lib/auth"

export const name = "get_brand"
export const description =
  "Returns the current brand configuration for this tenant's storefront (name, logo, colours, font, tagline)."

export const inputSchema = z.object({})

export async function handler(_input: z.infer<typeof inputSchema>, ctx: TenantContext): Promise<Brand> {
  const { data, error } = await ctx.supabase
    .from("site_contents")
    .select("value")
    .eq("key", "brand")
    .maybeSingle()

  if (error) throw new Error(`DB error: ${error.message}`)
  if (!data) return DEFAULT_BRAND

  const parsed = safeParseBrand(data.value)
  return parsed.success ? parsed.data : DEFAULT_BRAND
}
