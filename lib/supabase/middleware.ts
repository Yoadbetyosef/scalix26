import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isAdminEmail } from '@/lib/admin/emails'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public routes that don't need auth
  const publicRoutes = ['/auth/login', '/auth/signup', '/auth/forgot-password', '/auth/update-password', '/api/webhooks', '/api/auth/', '/api/leads/inbound', '/api/drip', '/api/mailbox', '/api/analytics', '/api/conversations/voice', '/api/appointments/available', '/api/appointments/book', '/api/reviews/process', '/api/reviews/send', '/api/tts', '/f/', '/privacy', '/terms']
  const adminRoutes = ['/admin', '/api/admin']

  const isAdminRoute = adminRoutes.some(r => pathname.startsWith(r))

  if (isAdminRoute) {
    // Optional HTTP Basic gate in FRONT of the email allow-list. Off unless explicitly
    // opted in with ADMIN_BASIC_AUTH=1 (plus a non-empty ADMIN_PASSWORD). This avoids a
    // stale/empty env value ever locking admins out behind a phantom password prompt — the
    // email allow-list below is the real access control.
    const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim()
    if (process.env.ADMIN_BASIC_AUTH === '1' && ADMIN_PASSWORD) {
      const authHeader = request.headers.get('authorization') || ''
      let validPassword = false
      if (authHeader.startsWith('Basic ')) {
        try {
          const decoded = atob(authHeader.slice(6))
          const [, pass] = decoded.split(':')
          validPassword = pass === ADMIN_PASSWORD
        } catch {}
      }
      if (!validPassword) {
        return new NextResponse('Authentication required', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="Admin Area"' },
        })
      }
    }

    if (user && !isAdminEmail(user.email)) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }
  const isPublic = publicRoutes.some(r => pathname.startsWith(r))

  if (!user && !isPublic && pathname !== '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  if (user && (pathname === '/auth/login' || pathname === '/auth/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
