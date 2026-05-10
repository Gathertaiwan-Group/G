import { notFound } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isEnabled } from "./check"
import type { ModuleKey } from "./registry"

/**
 * Server Component / Server Action helper. Calls Next's notFound() if the module
 * is disabled. Use at the top of a page.tsx that should be hidden when the
 * module is off. Caller is responsible for caching at the page level (Next's
 * fetch cache or a request-scoped memo).
 */
export async function gateModule(supabase: SupabaseClient, module: ModuleKey): Promise<void> {
  if (!(await isEnabled(supabase, module))) notFound()
}
