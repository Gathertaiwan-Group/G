import { z } from "zod"
import { MODULES, MODULE_KEYS, type ModuleKey } from "@repo/modules/src/registry"
import type { TenantContext } from "../lib/auth"

export const name = "set_module_enabled"
export const description =
  "Enables or disables a module. Rejects if enabling would violate a dependency (a required_module is disabled) or if disabling a module that another enabled module depends on."

export const inputSchema = z.object({
  module: z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]]),
  enabled: z.boolean(),
})

export async function handler(input: z.infer<typeof inputSchema>, ctx: TenantContext): Promise<Record<ModuleKey, boolean>> {
  const { module: moduleKey, enabled } = input

  // Fetch current config
  const { data, error } = await ctx.supabase
    .from("site_contents")
    .select("value")
    .eq("key", "module_config")
    .maybeSingle()

  if (error) throw new Error(`DB error: ${error.message}`)

  const stored = { ...(data?.value ?? {}) } as Record<string, boolean>
  // Normalise: any missing key = false
  for (const k of MODULE_KEYS) {
    if (!(k in stored)) stored[k] = false
  }

  if (enabled) {
    // Check that all dependencies are currently enabled
    const deps = MODULES[moduleKey].required_modules
    for (const dep of deps) {
      if (!stored[dep]) {
        throw new Error(
          `Cannot enable '${moduleKey}': required module '${dep}' is currently disabled. Enable '${dep}' first.`
        )
      }
    }
  } else {
    // Check that no other enabled module depends on this one
    for (const k of MODULE_KEYS) {
      if (k === moduleKey) continue
      if (!stored[k]) continue
      const deps = MODULES[k].required_modules
      if ((deps as readonly string[]).includes(moduleKey)) {
        throw new Error(
          `Cannot disable '${moduleKey}': module '${k}' is enabled and depends on it. Disable '${k}' first.`
        )
      }
    }
  }

  stored[moduleKey] = enabled

  const { error: upsertError } = await ctx.supabase
    .from("site_contents")
    .upsert({ key: "module_config", value: stored }, { onConflict: "key" })

  if (upsertError) throw new Error(`DB error: ${upsertError.message}`)

  return stored as Record<ModuleKey, boolean>
}
