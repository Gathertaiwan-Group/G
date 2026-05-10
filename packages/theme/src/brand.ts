import { z } from "zod"

export const FONT_FAMILIES = ["geist", "inter", "noto-sans-tc", "lxgw-wenkai", "gill-sans"] as const

/**
 * Strict 6-digit hex regex. Intentionally rejects 3-digit shorthand (#fff) and
 * 8-digit alpha (#ffffffff) so downstream CSS interpolation can never produce
 * a value that breaks out of a CSS declaration.
 *
 * Adding a new font here also requires the corresponding @font-face wiring in
 * apps/web's CSS (see B-3).
 */
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const HEX_MSG = "must be a 6-digit hex like #10305a"

const URL_RE = /^(\/|https?:\/\/)/
const URL_MSG = "must be a relative path (/...) or absolute https?:// URL"

const hex = () => z.string().regex(HEX_RE, HEX_MSG)
const assetUrl = () => z.string().min(1).regex(URL_RE, URL_MSG)

export const brandColorsSchema = z.object({
  primary: hex(),
  primary_foreground: hex(),
  accent: hex(),
  background: hex(),
  foreground: hex(),
})

export const brandSchema = z.object({
  name: z.string().min(1).max(80),
  tagline: z.string().max(200).optional(),
  logo_url: assetUrl(),
  favicon_url: assetUrl(),
  colors: brandColorsSchema,
  font_family: z.enum(FONT_FAMILIES, {
    message: `must be one of: ${FONT_FAMILIES.join(", ")}`,
  }),
})

export type Brand = z.infer<typeof brandSchema>
export type BrandColors = z.infer<typeof brandColorsSchema>

export function parseBrand(input: unknown): Brand {
  return brandSchema.parse(input)
}

export function safeParseBrand(input: unknown) {
  return brandSchema.safeParse(input)
}
