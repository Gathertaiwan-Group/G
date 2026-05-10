import { gateModule } from "@repo/modules"
import { createClient } from "@/lib/supabase/server"

export default async function AdminMembershipLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await gateModule(await createClient(), "membership_tiers")
  return <>{children}</>
}
