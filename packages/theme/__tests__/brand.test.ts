import { describe, it, expect } from "vitest"
import { brandSchema, DEFAULT_BRAND, parseBrand, safeParseBrand } from "../src"

describe("brandSchema", () => {
  it("accepts DEFAULT_BRAND", () => {
    expect(() => brandSchema.parse(DEFAULT_BRAND)).not.toThrow()
  })

  it("rejects non-hex colors", () => {
    expect(() =>
      brandSchema.parse({ ...DEFAULT_BRAND, colors: { ...DEFAULT_BRAND.colors, primary: "blue" } })
    ).toThrow()
  })

  it("rejects 3-digit shorthand hex", () => {
    expect(() =>
      brandSchema.parse({ ...DEFAULT_BRAND, colors: { ...DEFAULT_BRAND.colors, primary: "#fff" } })
    ).toThrow()
  })

  it("rejects 8-digit hex with alpha", () => {
    expect(() =>
      brandSchema.parse({
        ...DEFAULT_BRAND,
        colors: { ...DEFAULT_BRAND.colors, primary: "#ffffff80" },
      })
    ).toThrow()
  })

  it("accepts both lowercase and uppercase 6-digit hex", () => {
    expect(() =>
      brandSchema.parse({
        ...DEFAULT_BRAND,
        colors: { ...DEFAULT_BRAND.colors, primary: "#ABCDEF" },
      })
    ).not.toThrow()
    expect(() =>
      brandSchema.parse({
        ...DEFAULT_BRAND,
        colors: { ...DEFAULT_BRAND.colors, primary: "#abcdef" },
      })
    ).not.toThrow()
  })

  it("rejects font_family outside whitelist", () => {
    expect(() => brandSchema.parse({ ...DEFAULT_BRAND, font_family: "comic-sans" })).toThrow()
  })

  it("requires name >= 1 char", () => {
    expect(() => brandSchema.parse({ ...DEFAULT_BRAND, name: "" })).toThrow()
  })

  it("rejects logo_url that is not relative or https?", () => {
    expect(() =>
      brandSchema.parse({ ...DEFAULT_BRAND, logo_url: "javascript:alert(1)" })
    ).toThrow()
    expect(() => brandSchema.parse({ ...DEFAULT_BRAND, logo_url: "data:image/png;base64,xx" })).toThrow()
  })

  it("accepts logo_url as relative path or https URL", () => {
    expect(() => brandSchema.parse({ ...DEFAULT_BRAND, logo_url: "/logo.svg" })).not.toThrow()
    expect(() =>
      brandSchema.parse({ ...DEFAULT_BRAND, logo_url: "https://cdn.example.com/logo.svg" })
    ).not.toThrow()
  })

  it("treats tagline as optional", () => {
    const { tagline: _t, ...withoutTagline } = DEFAULT_BRAND
    expect(() => brandSchema.parse(withoutTagline)).not.toThrow()
  })

  it("surfaces a helpful message for non-hex color", () => {
    const result = safeParseBrand({
      ...DEFAULT_BRAND,
      colors: { ...DEFAULT_BRAND.colors, primary: "red" },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = JSON.stringify(result.error.issues)
      expect(msg).toMatch(/6-digit hex/)
    }
  })
})

describe("parseBrand / safeParseBrand", () => {
  it("parseBrand returns a Brand on valid input", () => {
    const b = parseBrand(DEFAULT_BRAND)
    expect(b.name).toBe(DEFAULT_BRAND.name)
  })

  it("safeParseBrand returns success: false on invalid input", () => {
    const r = safeParseBrand({ ...DEFAULT_BRAND, name: "" })
    expect(r.success).toBe(false)
  })
})
