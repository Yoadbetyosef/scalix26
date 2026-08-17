import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { PUBLIC_ROUTES } from './middleware'

// Every URL voice-server builds against the app must be reachable without a session.
//
// ── WHY THIS TEST EXISTS ────────────────────────────────────────────────────────────────────────────
//
// THREE routes the voice agent calls have shipped missing from PUBLIC_ROUTES, and the count is the
// argument for this file existing:
//
//   /api/catalog/lookup                  — shipped 307ing, found on a call
//   /api/catalog/keyterms                — the same fault two days later
//   /api/stripe/connect/payment-link     — found BY this test, on two branches independently, after
//                                          it had never once worked on a real call
//
// The failure is INVISIBLE every time:
//
//   middleware 307s to /auth/login  →  voice-server receives an HTML login page
//   →  JSON.parse throws            →  the catch skips the feature
//   →  the agent behaves exactly as it did before the feature existed
//
// Nothing errors. Nothing logs. The feature reads as shipped and does nothing, which is the same
// shape as the keyterm 'disabled' state and the silently-truncated crawl before it: a partial system
// that looks total. Only a real phone call reveals it, and only if someone happens to ask the right
// question.
//
// So this test reads the URLs out of voice-server's SOURCE rather than from a list someone maintains.
// A hand-kept list of "routes voice-server calls" would drift the same way PUBLIC_ROUTES did — the
// failure mode is forgetting, and a second thing to remember does not fix forgetting.
//
// This file was written TWICE, on two branches, within days of each other, neither author knowing the
// other had done it. Both arrived at the same design and both found the payment-link route. That is
// not a coincidence worth deleting: it is the strongest evidence available that the failure mode is
// real and that reading voice-server's source is the obvious answer to it.

const SERVER = readFileSync(new URL('../../voice-server/server.js', import.meta.url), 'utf8')

/**
 * Every `${appUrl}/api/...` path voice-server constructs.
 *
 * Matches the template-literal form the file actually uses. If someone builds a URL by another route —
 * string concatenation, a variable path — this will not see it, and the test says so below rather
 * than passing quietly on an empty set.
 */
function calledPaths(source: string): string[] {
  const found = new Set<string>()
  for (const m of source.matchAll(/\$\{appUrl\}(\/[a-zA-Z0-9/_-]+)/g)) found.add(m[1])
  return [...found].sort()
}

describe('every app route voice-server calls is public', () => {
  const paths = calledPaths(SERVER)

  it('finds the routes at all', () => {
    // Guards the regex itself. If voice-server is refactored to build URLs differently this drops to
    // zero and the suite would otherwise pass while checking nothing.
    expect(paths.length).toBeGreaterThanOrEqual(4)
    expect(paths).toContain('/api/catalog/lookup')
  })

  it.each(calledPaths(SERVER))('%s is in PUBLIC_ROUTES', (path) => {
    // Same prefix rule the middleware applies, so this cannot pass on a technicality the runtime
    // would reject.
    const covered = PUBLIC_ROUTES.some((r) => path.startsWith(r))
    expect(covered, `voice-server calls ${path} but no PUBLIC_ROUTES prefix covers it.\n` +
      `A call has no session: this would 307 to /auth/login, voice-server would parse the login page ` +
      `as JSON, and the failure would be swallowed silently. Add it to PUBLIC_ROUTES in ` +
      `lib/supabase/middleware.ts.`).toBe(true)
  })
})

describe('the allowlist itself stays honest', () => {
  it('opens no route more broadly than intended', () => {
    // '/api/catalog' would expose the whole catalog surface — products, costs, imports — to anyone.
    // Only the two specific voice paths belong here.
    expect(PUBLIC_ROUTES).not.toContain('/api/catalog')
    expect(PUBLIC_ROUTES).not.toContain('/api/')
    expect(PUBLIC_ROUTES).not.toContain('/api')
  })

  it('has no duplicate or shadowed entries', () => {
    // A prefix that already covers another entry means one of them is dead and misleading about what
    // is actually open.
    const shadowed = PUBLIC_ROUTES.filter((r) =>
      PUBLIC_ROUTES.some((other) => other !== r && r.startsWith(other)))
    expect(shadowed).toEqual([])
  })
})
