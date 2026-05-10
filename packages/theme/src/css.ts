import type { Brand } from "./brand"

export function brandToCssVars(brand: Brand): Record<string, string> {
  return {
    "--brand-primary": brand.colors.primary,
    "--brand-primary-foreground": brand.colors.primary_foreground,
    "--brand-accent": brand.colors.accent,
    "--brand-background": brand.colors.background,
    "--brand-foreground": brand.colors.foreground,
  }
}

export function brandToInlineStyle(brand: Brand): string {
  return Object.entries(brandToCssVars(brand))
    .map(([k, v]) => `${k}:${v}`)
    .join(";")
}
