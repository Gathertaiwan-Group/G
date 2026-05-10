import { describe, it, expect } from "vitest"
import { brandSchema, DEFAULT_BRAND } from "../src"

describe("brandSchema", () => {
  it("accepts DEFAULT_BRAND", () => {
    expect(() => brandSchema.parse(DEFAULT_BRAND)).not.toThrow()
  })
  it("rejects non-hex colors", () => {
    expect(() =>
      brandSchema.parse({ ...DEFAULT_BRAND, colors: { ...DEFAULT_BRAND.colors, primary: "blue" } })
    ).toThrow()
  })
  it("rejects font_family outside whitelist", () => {
    expect(() => brandSchema.parse({ ...DEFAULT_BRAND, font_family: "comic-sans" })).toThrow()
  })
  it("requires name >= 1 char", () => {
    expect(() => brandSchema.parse({ ...DEFAULT_BRAND, name: "" })).toThrow()
  })
})
