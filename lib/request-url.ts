import type { NextRequest } from 'next/server'

// Build the public base URL (proto + host) from the incoming request, so OAuth
// redirect URIs and post-flow redirects match the domain the user is actually on
// (e.g. app.mylocksmithai.com vs app.scalix26.com) rather than a hardcoded host.
// Falls back to NEXT_PUBLIC_APP_URL when no host header is present.
export function requestBaseUrl(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  if (!host) return process.env.NEXT_PUBLIC_APP_URL || ''
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}
