import { createControlClient } from "./control-db"
import { redirect } from "next/navigation"

export async function requirePlatformUser() {
  const supabase = await createControlClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { data: byAuthId } = await supabase
    .from("platform_users")
    .select("id, email, auth_user_id")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  if (byAuthId) return byAuthId

  const { data: byEmail, error } = await supabase
    .from("platform_users")
    .select("id, email, auth_user_id")
    .eq("email", user.email!)
    .maybeSingle()

  if (error || !byEmail) redirect("/auth/login?reason=not-platform-user")

  if (!byEmail.auth_user_id) {
    await supabase
      .from("platform_users")
      .update({ auth_user_id: user.id })
      .eq("id", byEmail.id)
  }

  return byEmail
}
