import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  // v2.* serves the design-preview tree at app/(v2)/v2 under the bare path, so the preview can be
  // reached at v2.<domain>/ instead of /v2. A rewrite, not a redirect: the URL the visitor sees is
  // unchanged. Deliberately BEFORE updateSession — this only rewrites the path, and the session
  // handling below then runs against the rewritten request exactly as it does for any other route.
  const host = request.headers.get('host') ?? ''
  if (host.startsWith('v2.')) {
    const url = request.nextUrl.clone()
    url.pathname = `/v2${url.pathname}`
    return NextResponse.rewrite(url)
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|gltf|bin|mp3|wav|woff|woff2|ttf|ico)$).*)',
  ],
}
