import { createClient, SupabaseClient } from "@supabase/supabase-js"

export function createControlClient(): SupabaseClient {
  const url = process.env.CONTROL_DB_URL
  const key = process.env.CONTROL_DB_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("CONTROL_DB_URL and CONTROL_DB_SERVICE_ROLE_KEY required")
  return createClient(url, key, { auth: { persistSession: false } })
}
