import type { Request, Response, NextFunction, RequestHandler } from "express"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isEnabled } from "./check"
import type { ModuleKey } from "./registry"

export interface ModuleGateOptions {
  supabase: SupabaseClient
  ttlMs?: number
  /**
   * Behavior when isEnabled throws (DB unavailable).
   * - "deny" (default): respond 503; safer for ungated routes that protect data
   * - "allow": pass through; safer for routes where availability matters more
   */
  onError?: "deny" | "allow"
}

/**
 * Returns Express middleware that 404s when the named module is disabled.
 * Caches successful module_config reads for `ttlMs` (default 60_000ms).
 *
 * Errors are NOT cached — a transient DB blip recovers on the next request
 * instead of being pinned for the full TTL window.
 *
 * Call once at route-mount time, not per-request, so the cache is shared
 * across requests for that route.
 */
export function requireModule(module: ModuleKey, opts: ModuleGateOptions): RequestHandler {
  let cache: { at: number; enabled: boolean } | null = null
  const ttl = opts.ttlMs ?? 60_000
  const onError = opts.onError ?? "deny"
  return async (_req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    if (!cache || now - cache.at > ttl) {
      try {
        cache = { at: now, enabled: await isEnabled(opts.supabase, module) }
      } catch {
        // Do not cache errors. Decide per request based on policy.
        if (onError === "deny") {
          res.status(503).json({ error: "Module configuration unavailable" })
          return
        }
        next()
        return
      }
    }
    if (!cache.enabled) {
      res.status(404).json({ error: "Not found" })
      return
    }
    next()
  }
}
