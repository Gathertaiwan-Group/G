import { z } from "zod"
import type { TenantContext } from "../lib/auth"

const HOMEPAGE_KEYS = ["hero", "banner", "section_titles", "membership_image"] as const
type HomepageKey = (typeof HOMEPAGE_KEYS)[number]

export const name = "update_homepage_copy"
export const description =
  "Stores a homepage content block under site_contents row keyed 'homepage_<key>'. Allowed keys: hero, banner, section_titles, membership_image."

export const inputSchema = z.object({
  key: z.enum(HOMEPAGE_KEYS),
  value: z.record(z.unknown()),
})

export async function handler(input: z.infer<typeof inputSchema>, ctx: TenantContext): Promise<{ key: HomepageKey; value: Record<string, unknown> }> {
  const contentKey = `homepage_${input.key}` as const

  const { error } = await ctx.supabase
    .from("site_contents")
    .upsert({ key: contentKey, value: input.value }, { onConflict: "key" })

  if (error) throw new Error(`DB error: ${error.message}`)

  return { key: input.key, value: input.value }
}
