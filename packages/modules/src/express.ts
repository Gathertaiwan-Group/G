import type { Request, Response, NextFunction, RequestHandler } from "express"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isEnabled } from "./check"
import type { ModuleKey } from "./registry"

export interface ModuleGateOptions {
  supabase: SupabaseClient
  ttlMs?: number
}

/**
 * Returns Express middleware that 404s when the named module is disabled.
 * Caches the module_config read for `ttlMs` (default 60_000ms, per spec §5 "within 60 seconds").
 */
export function requireModule(module: ModuleKey, opts: ModuleGateOptions): RequestHandler {
  let cache: { at: number; enabled: boolean } | null = null
  const ttl = opts.ttlMs ?? 60_000
  return async (_req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    if (!cache || now - cache.at > ttl) {
      cache = { at: now, enabled: await isEnabled(opts.supabase, module) }
    }
    if (!cache.enabled) {
      res.status(404).json({ error: "Not found" })
      return
    }
    next()
  }
}
