"use client"

import { useActionState, useState } from "react"
import { rotateMcpToken } from "./actions"

type State = { token: string | null; error: string | null }

// Spec §8 platform-admin MCP token rotation UI. The new plaintext token lives
// ONLY in this client component's transient React state for one-time display
// (copy affordance + "shown once" warning). It is never persisted, never
// re-fetchable, and never logged. Incident response if a token leaks:
// docs/runbooks/mcp-token-leak.md (PR-E5).
export function RotateToken({ tenantId }: { tenantId: string }) {
  const [copied, setCopied] = useState(false)

  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => {
      try {
        const token = await rotateMcpToken(formData)
        return { token, error: null }
      } catch (e) {
        return {
          token: null,
          error: e instanceof Error ? e.message : "rotation failed",
        }
      }
    },
    { token: null, error: null },
  )

  return (
    <div className="space-y-2">
      {!state.token && (
        <form action={formAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <button
            type="submit"
            disabled={pending}
            className="bg-foreground text-background rounded px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {pending ? "Rotating…" : "Rotate MCP token"}
          </button>
        </form>
      )}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.token && (
        <div className="space-y-2 rounded border border-orange-500/50 bg-orange-500/5 p-3">
          <p className="text-xs font-medium text-orange-600">
            New token — shown once. It is not stored or recoverable. Copy it
            now and deliver it to the customer over a secure channel. The
            previous token stopped working the moment you rotated.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">
              {state.token}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(state.token!)
                setCopied(true)
              }}
              className="rounded border px-2 py-1 text-xs"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
