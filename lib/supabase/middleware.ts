import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { enforce, clientIp } from '@/lib/ratelimit'

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

  // Brute-force cap on the PUBLIC invite-token page (`/invite/[token]`) — it has no route handler to
  // guard it. `/api/invite/accept` (different prefix) has its own tighter in-route limit.
  if (pathname.startsWith('/invite/')) {
    const limited = await enforce('invite_page', `ip:${clientIp(request)}`)
    if (limited) return limited
  }

  // Exit operator mode (clear the active_ws cookie) ONLY when the session is gone (sign-out).
  //
  // We must NOT clear active_ws just because a request path is /partner. The browser fires background
  // requests to /partner* — prefetch, RSC prefetch, and plain speculative fetches — even when no
  // /partner link is visible, and some of those carry NO prefetch header. Clearing on any such request
  // silently destroyed the operator session on the /dashboard load, so the next sidebar click fell out
  // of operator mode. (This was THE root cause of "clicking a sidebar item exits to the company dashboard".)
  //
  // Per product rule, operator mode is exited ONLY by explicit actions, each of which clears the cookie
  // server-side via POST /api/partner/workspace {action:'exit'}: the operator bar's "Back to Company"
  // and "Switch Business", and Sign Out. A stale/forged/suspended cookie is already inert because
  // getActiveWorkspace() re-validates ownership on every request.
  const clearWs = !user
  const withWsCleared = (res: NextResponse) => {
    if (clearWs) res.cookies.set('active_ws', '', { maxAge: 0, path: '/' })
    return res
  }

  // Public routes that don't need auth
  const publicRoutes = ['/auth/login', '/auth/signup', '/auth/forgot-password', '/auth/update-password', '/api/webhooks', '/api/auth/', '/api/leads/inbound', '/api/drip', '/api/mailbox', '/api/analytics', '/api/conversations/voice', '/api/appointments/available', '/api/appointments/book',
    // The voice agent's product lookup. Called by voice-server mid-call with the call's lead token
    // and no session, exactly like /api/appointments/available. The route resolves the tenant from
    // that token and gates on the inventory module itself — ONLY this path is public, not /api/catalog.
    '/api/catalog/lookup',
    // The keyterm list voice-server fetches at call setup, so Deepgram is told the product names a
    // general speech model has never heard. Same auth as the lookup above — a lead token, no session,
    // tenant resolved from the token — and it returns product NAMES only: no prices, no costs, no stock.
    //
    // Missing from this list is not a quiet degradation. The fetch 307s to /auth/login, voice-server
    // parses the login page as JSON, fails, and skips keyterms silently — which is exactly the
    // pre-existing behaviour, so nothing looks broken and every call stays mis-transcribed. That is
    // how /api/catalog/lookup shipped 307ing once already.
    '/api/catalog/keyterms',
    '/api/reviews/process', '/api/reviews/send', '/api/tts', '/f/', '/privacy', '/terms',
    // Partner OS public surface: referral redirect + click tracking, partner signup/login,
    // public demo pages + their data, and the public partner marketplace directory.
    '/r/', '/l/', '/api/partner/auth/', '/api/demos/', '/demo/', '/marketplace', '/partner/signup', '/partner/login',
    // White Label client-invite acceptance (recipient is not yet authenticated).
    '/invite/', '/api/invite/',
    // External order-approval: the factory/customer has no Scalix account — the secure token in the URL is
    // the sole credential (validated server-side in the route). Only these two prefixes are opened.
    '/approval/', '/api/approval/',
    // Public studio product page: the QR token in the URL is the sole capability (scanned by a customer /
    // supplier with no account). Server looks up by token; only public-safe fields are rendered.
    '/p/',
    // Public studio document page (quote / invoice / production order): the token in the URL is the sole
    // capability — the owner shares the link with a client/supplier who has no Scalix account.
    '/d/',
    // Scheduled jobs: Vercel/external cron requests carry NO user session, so they must bypass the
    // login redirect to reach the route — where cronAuthorized (the fail-closed CRON_SECRET bearer)
    // is the real gate. These are NOT open: a request without the secret gets 401 at the route.
    // (drip/reviews/mailbox/email-process are already covered above via /api/drip, /api/mailbox,
    //  /api/reviews/*, /api/webhooks.)
    '/api/brain/cron', '/api/partner/cron', '/api/learning/run', '/api/cron/']
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

    // Admin/role gating is enforced by the /admin layout (getAdminContext) and each
    // /api/admin route — both consult the admin_users table (which the edge middleware
    // can't read). This lets team members with a role reach the panel; non-admins are
    // bounced by the layout.
  }
  const isPublic = publicRoutes.some(r => pathname.startsWith(r))

  if (!user && !isPublic && pathname !== '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return withWsCleared(NextResponse.redirect(url))
  }

  // Suspended businesses: the owner's auth app_metadata carries `suspended` (getUser returns
  // fresh metadata). Block the app UI — only auth pages, the suspended page, the admin panel,
  // APIs, and public routes stay reachable.
  const suspended = !!(user?.app_metadata as { suspended?: boolean } | undefined)?.suspended
  if (suspended && user && !isPublic && !isAdminRoute && pathname !== '/suspended' && !pathname.startsWith('/auth') && !pathname.startsWith('/api')) {
    const url = request.nextUrl.clone()
    url.pathname = '/suspended'
    return withWsCleared(NextResponse.redirect(url))
  }

  // An already-authenticated user landing on an auth page goes to the root, which decides the
  // correct plane (partners → /partner, regular business users → /dashboard). Do NOT hardcode
  // /dashboard here — that bypasses the partner-vs-business routing in app/page.tsx.
  if (user && (pathname === '/auth/login' || pathname === '/auth/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return withWsCleared(supabaseResponse)
}
