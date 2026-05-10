import { describe, it, expect, vi } from "vitest"
import { gateModule } from "@repo/modules"

vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }) }))

describe("gateModule in pages", () => {
  it("calls notFound when module disabled", async () => {
    const supa = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: { courses: false } }, error: null }) }) }) }) } as never
    await expect(gateModule(supa, "courses")).rejects.toThrow("NEXT_NOT_FOUND")
  })
})
