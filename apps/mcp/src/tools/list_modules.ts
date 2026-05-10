import { z } from "zod"
import { MODULES, MODULE_KEYS, type ModuleKey } from "@repo/modules/src/registry"
import type { TenantContext } from "../lib/auth"

export const name = "list_modules"
export const description =
  "Returns the current module enable/disable state for this tenant, merged with each module's registry metadata (label, required_modules)."

export const inputSchema = z.object({})

type ModuleState = {
  enabled: boolean
  required_modules: string[]
  mcp_tools: string[]
}

export async function handler(_input: z.infer<typeof inputSchema>, ctx: TenantContext): Promise<Record<ModuleKey, ModuleState>> {
  const { data, error } = await ctx.supabase
    .from("site_contents")
    .select("value")
    .eq("key", "module_config")
    .maybeSingle()

  if (error) throw new Error(`DB error: ${error.message}`)

  const stored = (data?.value ?? {}) as Record<string, unknown>

  const result = {} as Record<ModuleKey, ModuleState>
  for (const key of MODULE_KEYS) {
    const meta = MODULES[key]
    result[key] = {
      enabled: stored[key] === true,
      required_modules: [...meta.required_modules],
      mcp_tools: [...meta.mcp_tools],
    }
  }
  return result
}
