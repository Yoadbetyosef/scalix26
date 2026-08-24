import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { PATHNAME_HEADER } from '@/lib/documents/routes'
import { enforce, clientIp } from '@/lib/ratelimit'

// Public routes that don't need auth — no session required to reach them.
//
// EXPORTED, and that is load-bearing rather than tidy. lib/supabase/public-routes.test.ts reads every
// URL voice-server constructs against the app and asserts each one is covered here.
//
// THREE routes have now shipped missing from this list: /api/catalog/lookup, then
// /api/catalog/keyterms, then /api/stripe/connect/payment-link — the last found by that test, on two
// branches independently, after it had never once worked on a real call. The failure is invisible
// every time: middleware 307s to /auth/login, voice-server parses a login page as JSON, the catch
// swallows it, and the agent behaves exactly as it did before the feature existed. Nothing errors and
// nothing logs, because the request SUCCEEDED — it returned a login page.
//
// See catalog-worker/OUTSTANDING.md §0 for the pattern.
export const PUBLIC_ROUTES = ['/auth/login', '/auth/signup', '/auth/forgot-password', '/auth/update-password', '/api/webhooks', '/api/auth/', '/api/leads/inbound', '/api/drip', '/api/mailbox', '/api/analytics', '/api/conversations/voice', '/api/appointments/available', '/api/appointments/book',
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
    // The AI's "send me a payment link" tool. FOUND BY lib/supabase/public-routes.test.ts, already
    // broken in production: voice-server has always called this, it has never been allowlisted, and
    // every attempt 307'd to a login page that the handler then failed to parse. The feature has never
    // worked on a phone call.
    //
    // Safe to open for the same reason as the two above, and no more: the route's own gate is the lead
    // token (`lead_intake_token` → tenant, 404 otherwise), which the middleware redirect was never
    // enforcing anyway — it was breaking the route, not protecting it. The exposure is identical to
    // /api/catalog/lookup and /api/appointments/book, which the same token already reaches.
    '/api/stripe/connect/payment-link',
    '/api/reviews/process', '/api/reviews/send', '/api/tts', '/f/',
  // The public product page behind a QR code. Same rule as /f/: the token is the credential, the
  // audience is the tenant's customer, and there is no session to have. Carried over from
  // catalog-parts, whose own copy of this list predated PUBLIC_ROUTES existing.
  '/q/', '/privacy', '/terms',
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
    // The customer's copy of an order document (estimate / quote / invoice). The token in the URL is
    // the sole credential — the recipient has no account — exactly like /d/ and /approval/ above.
    '/e/',
    // The customer's copy of a core INVOICE. Same arrangement again, and a third path on purpose:
    // /d/ resolves against studio_documents and four of those are already in customers' hands.
    '/i/',
    // Deciding a held draft from the SMS/email link. The OWNER is the recipient here rather than a
    // customer, but the arrangement is identical: no session, the token in the URL is the sole
    // credential, and it resolves to exactly one draft. ('/d/' was already taken by the studio
    // document page, hence '/m/'.)
    '/m/', '/api/m/',
    // Scheduled jobs: Vercel/external cron requests carry NO user session, so they must bypass the
    // login redirect to reach the route — where cronAuthorized (the fail-closed CRON_SECRET bearer)
    // is the real gate. These are NOT open: a request without the secret gets 401 at the route.
    // (drip/reviews/mailbox/email-process are already covered above via /api/drip, /api/mailbox,
    //  /api/reviews/*, /api/webhooks.)
    '/api/partner/cron', '/api/learning/run', '/api/cron/',
    // Azure publisher-domain verification. Microsoft fetches this with no session; a login 307
    // makes Entra think the file is missing (browser follows to /auth/login HTML).
    '/.well-known/']

export async function updateSession(request: NextRequest) {
  // Stamp the path onto the forwarded request so server components can know which route they are
  // rendering. Next exposes no supported API for this, and the root layout needs it to avoid
  // asserting a brand on a page whose audience is somebody else's customer — see lib/documents/routes.
  request.headers.set(PATHNAME_HEADER, request.nextUrl.pathname)

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

  const publicRoutes = PUBLIC_ROUTES
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
  // The /v2 rendering probe (app/(v2)/v2/render-probe) mounts the real hero with stub data so the
  // headless contrast and geometry checks measure the shipped components rather than a hand-built
  // HTML fixture. It needs no session because it reads no tenant data. Deliberately NOT added to
  // PUBLIC_ROUTES: that list is the production contract, and this opens only off production. The
  // page itself also calls notFound() in a production build, so this is the second of two locks.
  const isDevProbe = process.env.NODE_ENV !== 'production'
    && (pathname.startsWith('/v2/render-probe') || pathname.startsWith('/render-probe')
      // The component kit: v1 beside v2, for approval. Same two locks as the probes.
      || pathname.startsWith('/v2/kit'))
  const isPublic = isDevProbe || publicRoutes.some(r => pathname.startsWith(r))

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
