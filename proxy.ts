import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Skip static assets and Azure's publisher-domain file (must stay public, no auth redirect).
    '/((?!_next/static|_next/image|favicon.ico|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|gltf|bin|mp3|wav|woff|woff2|ttf|ico)$).*)',
  ],
}
