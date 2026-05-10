import { createControlClient } from "./control-db"
import { redirect } from "next/navigation"

export async function requirePlatformUser() {
  const supabase = await createControlClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { data: pu, error } = await supabase
    .from("platform_users")
    .select("id, email")
    .eq("email", user.email!)
    .maybeSingle()

  if (error || !pu) redirect("/auth/login?reason=not-platform-user")
  return pu
}
