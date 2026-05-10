import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "realreal.cc" },
      { protocol: "https", hostname: "www.realreal.cc" },
      { protocol: "https", hostname: "*.realreal.cc" },
    ],
  },
}

export default nextConfig
