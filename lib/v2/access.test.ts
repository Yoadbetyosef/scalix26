import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { mainDomainUrl } from './access'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const layout = strip(read('../../app/(v2)/v2/layout.tsx'))
const drafts = strip(read('../../app/api/miles/drafts/[id]/route.ts'))
const stop = strip(read('../../app/api/conversations/[id]/stop-followups/route.ts'))
const send = strip(read('../../app/api/conversations/[id]/send/route.ts'))
const takeover = strip(read('../../app/api/conversations/[id]/takeover/route.ts'))

/** The module reads V2_TENANT_IDS at import, so each case needs a fresh import. */
async function withEnv(v2: string | undefined, admins: string | undefined) {
  vi.resetModules()
  const prevV2 = process.env.V2_TENANT_IDS
  const prevAdmins = process.env.ADMIN_EMAILS
  if (v2 === undefined) delete process.env.V2_TENANT_IDS; else process.env.V2_TENANT_IDS = v2
  if (admins === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = admins
  const mod = await import('./access')
  return {
    ...mod,
    restore() {
      if (prevV2 === undefined) delete process.env.V2_TENANT_IDS; else process.env.V2_TENANT_IDS = prevV2
      if (prevAdmins === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = prevAdmins
    },
  }
}

describe('who may reach /v2', () => {
  afterEach(() => { vi.resetModules() })

  it('empty V2_TENANT_IDS means admins only — the correct default', async () => {
    // The gate exists from the start rather than being added once there is something to protect, and
    // nothing changes for the people who build it.
    const { v2Allowed, V2_TENANT_IDS, restore } = await withEnv('', undefined)
    expect(V2_TENANT_IDS).toEqual([])
    expect(v2Allowed('any-tenant', 'someone@example.com')).toBe(false)
    expect(v2Allowed('any-tenant', 'yoadbetyosef@gmail.com')).toBe(true)
    restore()
  })

  it('an allowlisted tenant passes whoever is signed in', async () => {
    // The unit of the gate is the unit of the blast radius: every /v2 write reaches ONE tenant's
    // customers, so a rollout is "this business", not "this person".
    const { v2Allowed, restore } = await withEnv('AAA-111, bbb-222 ', undefined)
    expect(v2Allowed('aaa-111', 'staff@business.com')).toBe(true)
    expect(v2Allowed('AAA-111', 'other@business.com')).toBe(true)
    expect(v2Allowed('bbb-222', null)).toBe(true)
    expect(v2Allowed('ccc-333', 'staff@business.com')).toBe(false)
    restore()
  })

  it('admins always pass, whatever the env says', async () => {
    // Same reasoning lib/admin/emails.ts gives for hardcoding SUPER_ADMINS: an empty, mistyped or
    // stale-baked variable must never lock out the people who build it.
    const { v2Allowed, restore } = await withEnv(undefined, 'extra@scalix26.com')
    expect(v2Allowed(null, 'yoadbetyosef@gmail.com')).toBe(true)
    expect(v2Allowed(null, 'EXTRA@Scalix26.com')).toBe(true)
    expect(v2Allowed(null, null)).toBe(false)
    restore()
  })

  it('no tenant and no admin email is a no', async () => {
    const { v2Allowed, restore } = await withEnv('aaa-111', undefined)
    expect(v2Allowed(null, 'nobody@example.com')).toBe(false)
    expect(v2Allowed(undefined, undefined)).toBe(false)
    expect(v2Allowed('', '')).toBe(false)
    restore()
  })
})

describe('the redirect leaves the preview host', () => {
  it('strips the v2. label so the blocked user gets a dashboard, not a 404', () => {
    // proxy.ts rewrites EVERY path to /v2<path> on that host, so a relative redirect('/dashboard')
    // would be rewritten to /v2/dashboard, which does not exist.
    expect(mainDomainUrl('v2.scalix26.com')).toBe('https://scalix26.com/dashboard')
    expect(mainDomainUrl('v2.app.scalix26.com', '/inbox')).toBe('https://app.scalix26.com/inbox')
  })

  it('leaves a main host alone', () => {
    expect(mainDomainUrl('app.scalix26.com')).toBe('https://app.scalix26.com/dashboard')
    // Only the leading label — a host that merely contains "v2" is untouched.
    expect(mainDomainUrl('myv2.example.com')).toBe('https://myv2.example.com/dashboard')
  })

  it('does not send localhost to https', () => {
    expect(mainDomainUrl('localhost:3000')).toBe('http://localhost:3000/dashboard')
    expect(mainDomainUrl('v2.localhost:3000')).toBe('http://localhost:3000/dashboard')
  })
})

describe('where the gate is', () => {
  it('the layout runs it, on the ACTIVE tenant', () => {
    // getActiveTenantId returns the active WORKSPACE, so a partner operating a client tenant is
    // judged by that client's tenant — right by construction, no special case.
    expect(layout).toContain('const tenantId = await getActiveTenantId()')
    expect(layout).toContain('if (!v2Allowed(tenantId, user.email))')
    expect(layout).toContain('redirect(mainDomainUrl(')
    expect(layout).toContain('export default async function V2Layout')
  })

  it('signing in is still the middleware’s job, not this one’s', () => {
    // The layout only answers WHO. A logged-out visitor has already been redirected to /auth/login.
    expect(layout).toContain('if (user) {')
  })

  it('the two /v2-only endpoints carry it too — a layout does not cover a route handler', () => {
    expect(drafts).toContain('if (!v2Allowed(tenantId, user.email))')
    expect(drafts).toContain("status: 403")
    expect(stop).toContain('if (!v2Allowed(ctx.tenantId, user?.email))')
    expect(stop).toContain("status: 403")
  })

  it('and the SHARED endpoints deliberately do not — v1 calls them', () => {
    expect(send).not.toContain('v2Allowed')
    expect(takeover).not.toContain('v2Allowed')
    for (const f of ['../../components/inbox/message-composer.tsx', '../../components/inbox/human-takeover.tsx']) {
      expect(read(f)).toContain('/api/conversations/')
    }
  })

  it('it is not in the middleware, and that is deliberate', () => {
    // The edge cannot resolve a tenant — that needs cookies plus two Supabase reads. The middleware
    // says the same thing about /admin, and app/admin/layout.tsx is the same four lines.
    const mw = read('../supabase/middleware.ts')
    expect(mw).not.toContain('v2Allowed')
    expect(read('../../app/admin/layout.tsx')).toContain("redirect('/dashboard')")
  })

  it('no v2 page gets in without it', () => {
    // One layout over fifteen pages. listPageContext does not cover all of them — the home page does
    // its own session work — so a per-page check would already have a hole in it.
    expect(layout).toContain("import { v2Allowed, mainDomainUrl } from '@/lib/v2/access'")
  })
})
