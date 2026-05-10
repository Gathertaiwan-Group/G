import { describe, it, expect } from "vitest"
import { brandToCssVars, brandToInlineStyle } from "../src"
import { DEFAULT_BRAND } from "../src"

describe("brandToCssVars", () => {
  it("maps all 5 color keys to CSS variable names", () => {
    const vars = brandToCssVars(DEFAULT_BRAND)
    expect(vars["--brand-primary"]).toBe(DEFAULT_BRAND.colors.primary)
    expect(vars["--brand-primary-foreground"]).toBe(DEFAULT_BRAND.colors.primary_foreground)
    expect(vars["--brand-accent"]).toBe(DEFAULT_BRAND.colors.accent)
    expect(vars["--brand-background"]).toBe(DEFAULT_BRAND.colors.background)
    expect(vars["--brand-foreground"]).toBe(DEFAULT_BRAND.colors.foreground)
  })
})

describe("brandToInlineStyle", () => {
  it("returns a semicolon-separated CSS string", () => {
    const style = brandToInlineStyle(DEFAULT_BRAND)
    expect(style).toContain("--brand-primary:#10305a")
    expect(style).toContain(";")
  })
})
