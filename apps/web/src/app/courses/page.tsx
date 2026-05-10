import { gateModule } from "@repo/modules"
import { createClient } from "@/lib/supabase/server"

export const metadata = {
  title: "課程 | 誠真生活 RealReal",
}

export default async function CoursesPage() {
  await gateModule(await createClient(), "courses")
  return (
    <main className="p-8">
      <h1>Courses (coming soon)</h1>
    </main>
  )
}
