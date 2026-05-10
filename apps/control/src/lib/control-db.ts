import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createControlClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_CONTROL_DB_URL!,
    process.env.NEXT_PUBLIC_CONTROL_DB_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cs) { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
      },
    },
  )
}
