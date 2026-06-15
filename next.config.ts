import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Native/server-only render deps — never bundle them into route chunks (Turbopack can't place the
  // `.node` binding). They are required at runtime instead (the server runs under Bun; see README).
  serverExternalPackages: ['@resvg/resvg-js', 'satori'],
}

export default nextConfig
