import { NextResponse, type NextRequest } from "next/server"
import { createControlClient } from "@/lib/control-db"

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  if (code) {
    const supabase = await createControlClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(new URL("/auth/login?reason=callback-error", req.url))
    }
  }
  return NextResponse.redirect(new URL("/", req.url))
}
