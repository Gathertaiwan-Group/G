import { brandColorsSchema, type Brand } from "./brand"

export function brandToCssVars(brand: Brand): Record<string, string> {
  // Re-validate at the boundary even if the type says Brand. Defense-in-depth
  // against a caller passing an `as Brand` cast — guarantees no CSS injection.
  const colors = brandColorsSchema.parse(brand.colors)
  return {
    "--brand-primary": colors.primary,
    "--brand-primary-foreground": colors.primary_foreground,
    "--brand-accent": colors.accent,
    "--brand-background": colors.background,
    "--brand-foreground": colors.foreground,
  }
}

export function brandToInlineStyle(brand: Brand): string {
  return Object.entries(brandToCssVars(brand))
    .map(([k, v]) => `${k}:${v}`)
    .join(";")
}
