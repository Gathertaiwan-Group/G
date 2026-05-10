import { gateModule } from "@repo/modules"
import { createClient } from "@/lib/supabase/server"

export default async function CampaignsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await gateModule(await createClient(), "campaigns")
  return <>{children}</>
}
