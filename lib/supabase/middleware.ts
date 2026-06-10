import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
  const publicRoutes = ['/auth/login', '/auth/signup', '/auth/forgot-password', '/auth/update-password', '/api/webhooks', '/api/auth/', '/api/leads/inbound', '/privacy', '/terms']
  const adminRoutes = ['/admin', '/api/admin']
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'yoadbetyosef@gmail.com').split(',').map(e => e.trim())

  const isAdminRoute = adminRoutes.some(r => pathname.startsWith(r))

  if (isAdminRoute) {
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
    if (ADMIN_PASSWORD) {
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

    if (user && !ADMIN_EMAILS.includes(user.email || '')) {
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
