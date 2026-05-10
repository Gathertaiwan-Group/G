import { requirePlatformUser } from "@/lib/auth"

export const metadata = { title: "Platform Control" }

export default async function HomePage() {
  const user = await requirePlatformUser()
  return (
    <main className="p-8 space-y-4">
      <h1 className="text-xl font-semibold">Platform Control</h1>
      <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
      <p className="text-sm">Phase A scaffold — pages get real content in PR-A6.</p>
    </main>
  )
}
