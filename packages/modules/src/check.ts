import type { SupabaseClient } from "@supabase/supabase-js"
import { MODULE_KEYS, type ModuleKey } from "./registry"

export type ModuleConfig = Partial<Record<ModuleKey, boolean>>

const DEFAULT_DISABLED: ModuleConfig = Object.fromEntries(
  MODULE_KEYS.map((k) => [k, false])
) as ModuleConfig

/**
 * Read site_contents.module_config. Falls back to all-disabled on any error.
 * Callers should cache (60s TTL recommended) at the call site; this fn is uncached.
 */
export async function getModuleConfig(supabase: SupabaseClient): Promise<ModuleConfig> {
  const { data, error } = await supabase
    .from("site_contents")
    .select("value")
    .eq("key", "module_config")
    .single()
  if (error || !data) return DEFAULT_DISABLED
  return { ...DEFAULT_DISABLED, ...(data.value as ModuleConfig) }
}

export async function isEnabled(supabase: SupabaseClient, module: ModuleKey): Promise<boolean> {
  const cfg = await getModuleConfig(supabase)
  return cfg[module] === true
}
