import { NextResponse, type NextRequest } from "next/server"

export async function proxy(_req: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
