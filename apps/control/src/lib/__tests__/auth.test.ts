import { describe, it, expect, vi, beforeEach } from "vitest"

const redirectMock = vi.fn((path: string) => {
  throw new Error(`__redirect:${path}`)
})

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}))

const createControlClientMock = vi.fn()

vi.mock("../control-db", () => ({
  createControlClient: () => createControlClientMock(),
}))

import { requirePlatformUser } from "../auth"

type Row = { id: string; email: string; auth_user_id: string | null }

interface QueryState {
  byAuthId: Row | null
  byEmail: Row | null
  updateCalls: { id: string; auth_user_id: string }[]
}

function buildClient(state: QueryState, sessionUser: { id: string; email: string } | null) {
  const auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user: sessionUser } }),
  }

  function from(table: string) {
    expect(table).toBe("platform_users")
    let column = ""
    let value: unknown = null

    const builder: any = {
      select() { return builder },
      eq(col: string, v: unknown) {
        column = col
        value = v
        return builder
      },
      maybeSingle: vi.fn(async () => {
        if (column === "auth_user_id") return { data: state.byAuthId, error: null }
        if (column === "email") return { data: state.byEmail, error: null }
        return { data: null, error: null }
      }),
      update(patch: { auth_user_id: string }) {
        return {
          eq: vi.fn(async (col: string, id: string) => {
            expect(col).toBe("id")
            state.updateCalls.push({ id, auth_user_id: patch.auth_user_id })
            return { error: null }
          }),
        }
      },
    }
    return builder
  }

  return { auth, from }
}

beforeEach(() => {
  redirectMock.mockClear()
  createControlClientMock.mockReset()
})

describe("requirePlatformUser", () => {
  it("redirects to /auth/login when no session", async () => {
    createControlClientMock.mockResolvedValue(
      buildClient({ byAuthId: null, byEmail: null, updateCalls: [] }, null)
    )
    await expect(requirePlatformUser()).rejects.toThrow("__redirect:/auth/login")
    expect(redirectMock).toHaveBeenCalledWith("/auth/login")
  })

  it("returns the row matched by auth_user_id (fast path) without backfilling", async () => {
    const row = { id: "p1", email: "ops@example.com", auth_user_id: "u1" }
    const state: QueryState = { byAuthId: row, byEmail: null, updateCalls: [] }
    createControlClientMock.mockResolvedValue(
      buildClient(state, { id: "u1", email: "ops@example.com" })
    )
    const result = await requirePlatformUser()
    expect(result).toEqual(row)
    expect(state.updateCalls).toHaveLength(0)
  })

  it("falls back to email match and backfills auth_user_id when null", async () => {
    const row = { id: "p2", email: "ops@example.com", auth_user_id: null }
    const state: QueryState = { byAuthId: null, byEmail: row, updateCalls: [] }
    createControlClientMock.mockResolvedValue(
      buildClient(state, { id: "u2", email: "ops@example.com" })
    )
    const result = await requirePlatformUser()
    expect(result).toEqual(row)
    expect(state.updateCalls).toEqual([{ id: "p2", auth_user_id: "u2" }])
  })

  it("does not re-backfill when email match already has an auth_user_id", async () => {
    const row = { id: "p3", email: "ops@example.com", auth_user_id: "u-old" }
    const state: QueryState = { byAuthId: null, byEmail: row, updateCalls: [] }
    createControlClientMock.mockResolvedValue(
      buildClient(state, { id: "u-new", email: "ops@example.com" })
    )
    const result = await requirePlatformUser()
    expect(result).toEqual(row)
    expect(state.updateCalls).toHaveLength(0)
  })

  it("redirects to login with not-platform-user reason when neither lookup matches", async () => {
    const state: QueryState = { byAuthId: null, byEmail: null, updateCalls: [] }
    createControlClientMock.mockResolvedValue(
      buildClient(state, { id: "u-stranger", email: "stranger@example.com" })
    )
    await expect(requirePlatformUser()).rejects.toThrow("__redirect:/auth/login?reason=not-platform-user")
    expect(redirectMock).toHaveBeenCalledWith("/auth/login?reason=not-platform-user")
  })
})
