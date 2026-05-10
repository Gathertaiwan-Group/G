import { NextResponse, type NextRequest } from "next/server"
import { createControlClient } from "@/lib/control-db"

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  if (code) {
    const supabase = await createControlClient()
    await supabase.auth.exchangeCodeForSession(code)
  }
  return NextResponse.redirect(new URL("/", req.url))
}
