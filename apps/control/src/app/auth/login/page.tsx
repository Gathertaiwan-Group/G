"use client"

import { useState } from "react"
import { createBrowserClient } from "@supabase/ssr"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_CONTROL_DB_URL!,
      process.env.NEXT_PUBLIC_CONTROL_DB_ANON_KEY!,
    )
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Platform Control</h1>
        {sent ? (
          <p className="text-sm text-muted-foreground">Magic link sent. Check {email}.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <button type="submit" className="w-full bg-foreground text-background rounded py-2 text-sm">
              Send magic link
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>
        )}
      </div>
    </main>
  )
}
