import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The probe renders the real hero with no session, so it must not exist in production.
//
// It is locked twice, deliberately. The route still appears in a production build's route list —
// Next compiles it either way — so "it is dev-only" has to be enforced in code rather than assumed
// from the folder it sits in.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page = read('app/(v2)/v2/render-probe/page.tsx')
const middleware = read('lib/supabase/middleware.ts')

describe('the render probe is unreachable in production', () => {
  it('404s from the page itself', () => {
    expect(page).toMatch(/if \(process\.env\.NODE_ENV === 'production'\) notFound\(\)/)
    // Before anything else in the component: a probe that renders and then 404s has already run.
    const body = page.slice(page.indexOf('export default async function V2Probe'))
    expect(body.indexOf('notFound()')).toBeLessThan(body.indexOf('<HomeClient'))
  })

  it('is opened by the middleware only off production, and never via PUBLIC_ROUTES', () => {
    // Two probe roots: the one inside the (v2) group, and the bare one outside it that renders in a
    // v1 page's CSS environment. Both dev-only, by the same condition.
    expect(middleware).toMatch(/const isDevProbe = process\.env\.NODE_ENV !== 'production'/)
    expect(middleware).toMatch(/pathname\.startsWith\('\/v2\/render-probe'\) \|\| pathname\.startsWith\('\/render-probe'\)/)
    expect(middleware).toMatch(/const isPublic = isDevProbe \|\| publicRoutes\.some/)
    // PUBLIC_ROUTES is the production contract. The probe must not be in it.
    const list = middleware.slice(middleware.indexOf('PUBLIC_ROUTES = ['), middleware.indexOf('const isAdminRoute'))
    expect(list).not.toMatch(/render-probe/)
  })

  it('reads no tenant data, so there is nothing to leak even if a lock failed', () => {
    expect(page).not.toMatch(/createClient|createAdminClient|getActiveTenantId|loadHomeData|loadShell/)
  })
})

describe('the bare probe, outside the (v2) group, is locked the same way', () => {
  // It exists to render v1 components in a v1 page's CSS environment — no v2-tokens.css — which is
  // the only way to know whether something that works in the preview also works on the dashboard.
  const bare = read('app/render-probe/orb/page.tsx')

  it('404s in production from the page itself', () => {
    expect(bare).toMatch(/if \(process\.env\.NODE_ENV === 'production'\) notFound\(\)/)
  })

  it('reads no tenant data', () => {
    expect(bare).not.toMatch(/createClient|createAdminClient|getActiveTenantId/)
  })
})
