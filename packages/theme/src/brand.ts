import { z } from "zod"

export const FONT_FAMILIES = ["geist", "inter", "noto-sans-tc", "lxgw-wenkai", "gill-sans"] as const

export const brandColorsSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  primary_foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})

export const brandSchema = z.object({
  name: z.string().min(1).max(80),
  tagline: z.string().max(200).default(""),
  logo_url: z.string().min(1),
  favicon_url: z.string().min(1),
  colors: brandColorsSchema,
  font_family: z.enum(FONT_FAMILIES),
})

export type Brand = z.infer<typeof brandSchema>
export type BrandColors = z.infer<typeof brandColorsSchema>
