import { gateModule } from "@repo/modules"
import { createClient } from "@/lib/supabase/server"

export default async function AdminPostsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await gateModule(await createClient(), "cms_posts")
  return <>{children}</>
}
