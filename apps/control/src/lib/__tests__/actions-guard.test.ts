import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const files = [
  "src/app/tenants/[id]/provision/actions.ts",
  "src/app/tenants/[id]/suspend/actions.ts",
  "src/app/tenants/[id]/token/actions.ts",
]

describe("server actions are auth-guarded", () => {
  it.each(files)("%s calls requirePlatformUser before any DB write", (rel) => {
    const src = readFileSync(rel, "utf8")
    // every exported async action must await requirePlatformUser() before
    // createControlClient() / any query helper
    const guardIdx = src.indexOf("await requirePlatformUser()")
    const clientIdx = src.indexOf("createControlClient(")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(clientIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(clientIdx)
  })

  it.each(files)("%s declares the \"use server\" directive", (rel) => {
    const src = readFileSync(rel, "utf8")
    expect(src.trimStart().startsWith('"use server"')).toBe(true)
  })
})
