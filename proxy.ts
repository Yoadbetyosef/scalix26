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
    // TWO EXCLUSIONS, BOTH LOAD-BEARING, MERGED RATHER THAN CHOSEN BETWEEN.
    //
    // mp4/webm sit beside mp3/wav: a media file has no session to update, and running the auth
    // middleware on a video means a redirect for a logged-out visitor and a wasted round trip for
    // everyone else. Found by fetching the hero's own assets — .webp returned 200 and .mp4 returned
    // 307, from the same directory.
    //
    // \.well-known/ is Azure publisher-domain verification. Microsoft fetches it with no session; a
    // login 307 makes Entra think the file is missing, because the browser follows to /auth/login HTML.
    //
    // These arrived on two branches, days apart, editing the same regex for the same reason. Taking
    // either side wholesale silently reverts the other — video goes back to 307, or Entra stops
    // seeing the file. Neither failure announces itself.
    '/((?!_next/static|_next/image|favicon.ico|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|gltf|bin|mp3|mp4|webm|wav|woff|woff2|ttf|ico)$).*)',
  ],
}
