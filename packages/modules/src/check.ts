import type { SupabaseClient } from "@supabase/supabase-js"
import { MODULES, MODULE_KEYS, type ModuleKey } from "./registry"

export type ModuleConfig = Partial<Record<ModuleKey, boolean>>

const DEFAULT_DISABLED: ModuleConfig = Object.fromEntries(
  MODULE_KEYS.map((k) => [k, false])
) as ModuleConfig

/**
 * Read site_contents.module_config and return a normalized config.
 *
 * Throws on DB error so callers can distinguish "module disabled" from
 * "we couldn't ask". Callers should decide fail-open vs fail-closed.
 *
 * Returns DEFAULT_DISABLED only when the row is genuinely absent (PGRST116).
 */
export async function getModuleConfig(supabase: SupabaseClient): Promise<ModuleConfig> {
  const { data, error } = await supabase
    .from("site_contents")
    .select("value")
    .eq("key", "module_config")
    .maybeSingle()
  if (error) throw new Error(`module_config read failed: ${error.message}`)
  if (!data) return DEFAULT_DISABLED
  const raw = (data.value ?? {}) as Record<string, unknown>
  const sanitized: ModuleConfig = { ...DEFAULT_DISABLED }
  for (const k of MODULE_KEYS) {
    if (raw[k] === true) sanitized[k] = true
  }
  return sanitized
}

/**
 * Resolve effective enablement. A module is enabled iff:
 *   1. its own flag is true, AND
 *   2. every module in `required_modules` is also (recursively) enabled.
 *
 * required_modules is therefore enforcing, not advisory — disabling a base
 * module silently disables everything that depends on it.
 */
export async function isEnabled(supabase: SupabaseClient, module: ModuleKey): Promise<boolean> {
  const cfg = await getModuleConfig(supabase)
  return resolveEnabled(cfg, module, new Set())
}

function resolveEnabled(cfg: ModuleConfig, module: ModuleKey, seen: Set<ModuleKey>): boolean {
  if (seen.has(module)) return true
  seen.add(module)
  if (cfg[module] !== true) return false
  for (const dep of MODULES[module].required_modules) {
    // Deps not registered in MODULES (e.g. `payments`) are treated as
    // always-on virtual modules per spec — they're platform invariants,
    // not user-toggleable. Only enforce checks for registered deps.
    if (!(dep in MODULES)) continue
    if (!resolveEnabled(cfg, dep as ModuleKey, seen)) return false
  }
  return true
}
