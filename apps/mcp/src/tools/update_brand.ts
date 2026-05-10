import { z } from "zod"
import { DEFAULT_BRAND, safeParseBrand, brandSchema, type Brand } from "@repo/theme"
import type { TenantContext } from "../lib/auth"

export const name = "update_brand"
export const description =
  "Deep-merges the provided patch into the current brand config, validates the result, and persists it. Returns the full updated brand."

// Accept a partial brand shape for the patch — all fields optional
export const inputSchema = z.object({
  patch: z.object({
    name: z.string().min(1).max(80).optional(),
    tagline: z.string().max(200).optional(),
    logo_url: z.string().min(1).optional(),
    favicon_url: z.string().min(1).optional(),
    colors: z
      .object({
        primary: z.string().optional(),
        primary_foreground: z.string().optional(),
        accent: z.string().optional(),
        background: z.string().optional(),
        foreground: z.string().optional(),
      })
      .optional(),
    font_family: z.string().optional(),
  }),
})

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base }
  for (const key of Object.keys(patch)) {
    const pv = patch[key]
    const bv = base[key]
    if (pv !== undefined && pv !== null && typeof pv === "object" && !Array.isArray(pv) &&
        typeof bv === "object" && bv !== null && !Array.isArray(bv)) {
      result[key] = deepMerge(bv as Record<string, unknown>, pv as Record<string, unknown>)
    } else if (pv !== undefined) {
      result[key] = pv
    }
  }
  return result
}

export async function handler(input: z.infer<typeof inputSchema>, ctx: TenantContext): Promise<Brand> {
  // Fetch current brand
  const { data: existing, error: fetchError } = await ctx.supabase
    .from("site_contents")
    .select("value")
    .eq("key", "brand")
    .maybeSingle()

  if (fetchError) throw new Error(`DB error: ${fetchError.message}`)

  const currentParsed = safeParseBrand(existing?.value)
  const current: Brand = currentParsed.success ? currentParsed.data : DEFAULT_BRAND

  // Deep merge
  const merged = deepMerge(current as unknown as Record<string, unknown>, input.patch as Record<string, unknown>)

  // Validate the merged result with the strict schema
  const validated = brandSchema.parse(merged)

  // Upsert
  const { error: upsertError } = await ctx.supabase
    .from("site_contents")
    .upsert({ key: "brand", value: validated }, { onConflict: "key" })

  if (upsertError) throw new Error(`DB error: ${upsertError.message}`)

  return validated
}
