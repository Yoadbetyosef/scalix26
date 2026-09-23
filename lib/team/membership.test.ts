import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// ── ONE BUSINESS, MORE THAN ONE LOGIN ───────────────────────────────────────────────────────────────
//
// The regression set for team accounts. The first eight describes map one-to-one onto the cases that
// have to keep holding: the owner still gets in, the secretary gets into the SAME business, she cannot
// accidentally mint a second one, she can work but cannot touch billing or the team, somebody from
// another business gets nothing, removing her takes effect immediately, and every existing
// single-user customer resolves exactly as they did before any of this existed.
//
// Mocked at the Supabase boundary in the style of lib/studio/staff-mode.test.ts, so what is under test
// is the RESOLUTION ORDER rather than a database.

const YDC = '8041c0b5-c960-48bd-a3f7-655f5a0b6434'
const OTHER_BIZ = 'cca31bcc-1111-2222-3333-444455556666'
const OWNER_ID = 'user-owner-ydc'
const SECRETARY_ID = 'user-secretary-ydc'
const OUTSIDER_ID = 'user-outsider'

const h = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  /** tenants rows keyed by owner user_id — the ownership lookup. */
  ownedByUser: {} as Record<string, { id: string; business_name: string; white_label_partner_id: string | null } | null>,
  /** tenant_members rows keyed by user_id, already filtered to status='active'. */
  activeMembership: {} as Record<string, { id: string; tenant_id: string; role: string } | null>,
  /** tenants rows keyed by id — the read after a membership resolves. */
  tenantsById: {} as Record<string, { id: string; business_name: string; white_label_partner_id: string | null; suspended_at: string | null } | null>,
  accepted: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'tenant_members') {
        return {
          select: () => ({
            eq: (_c1: string, userId: string) => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({ maybeSingle: async () => ({ data: h.activeMembership[userId] ?? null, error: null }) }),
                }),
              }),
            }),
          }),
          update: () => ({ eq: (_c: string, id: string) => ({ is: async () => { h.accepted.push(id); return { error: null } } }) }),
        }
      }
      // tenants
      return {
        select: () => ({
          eq: (col: string, val: string) => ({
            // .eq('user_id', x).order().limit().maybeSingle()  → ownership
            order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: h.ownedByUser[val] ?? null }) }) }),
            // .eq('id', x).maybeSingle()                        → the membership's tenant
            maybeSingle: async () => ({ data: col === 'id' ? (h.tenantsById[val] ?? null) : null }),
          }),
        }),
      }
    },
  }),
}))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/partner/rbac', () => ({ getPartnerContext: async () => null }))

const { getActiveWorkspace, requireActiveBusinessContext } = await import('@/lib/workspace')

beforeEach(() => {
  vi.resetModules()
  h.user = null
  h.accepted = []
  h.ownedByUser = {
    [OWNER_ID]: { id: YDC, business_name: 'Your Design Collective', white_label_partner_id: null },
    [SECRETARY_ID]: null,
    [OUTSIDER_ID]: { id: OTHER_BIZ, business_name: 'Some Other Business', white_label_partner_id: null },
  }
  h.activeMembership = {
    [SECRETARY_ID]: { id: 'member-1', tenant_id: YDC, role: 'staff' },
    [OWNER_ID]: null,
    [OUTSIDER_ID]: null,
  }
  h.tenantsById = {
    [YDC]: { id: YDC, business_name: 'Your Design Collective', white_label_partner_id: null, suspended_at: null },
    [OTHER_BIZ]: { id: OTHER_BIZ, business_name: 'Some Other Business', white_label_partner_id: null, suspended_at: null },
  }
})

// 1 ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('the owner still gets into their own business', () => {
  it('resolves through ownership, with full capability', async () => {
    h.user = { id: OWNER_ID, email: 'owner@ydc.example' }
    const ws = await getActiveWorkspace()
    expect(ws.tenantId).toBe(YDC)
    expect(ws.role).toBe('owner')

    const ctx = await requireActiveBusinessContext()
    expect(ctx?.tenantId).toBe(YDC)
    expect(ctx?.capabilities.canEditBilling).toBe(true)
    expect(ctx?.capabilities.canManageTeam).toBe(true)
  })

  it('never consults the membership table when they own a tenant', async () => {
    // The safety property the whole migration rests on: ownership is checked FIRST, so an owner's
    // resolution cannot be changed by anything in tenant_members.
    h.user = { id: OWNER_ID, email: 'owner@ydc.example' }
    h.activeMembership[OWNER_ID] = { id: 'bogus', tenant_id: OTHER_BIZ, role: 'staff' }
    const ws = await getActiveWorkspace()
    expect(ws.tenantId).toBe(YDC)
    expect(ws.role).toBe('owner')
  })
})

// 2 ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('the secretary reaches the SAME business', () => {
  it('resolves to the owner’s tenant id, not a new one', async () => {
    h.user = { id: SECRETARY_ID, email: 'info@yourdesignco.com' }
    const ws = await getActiveWorkspace()
    expect(ws.tenantId).toBe(YDC)
    expect(ws.businessName).toBe('Your Design Collective')
    expect(ws.role).toBe('staff')
  })

  it('stamps first sign-in so the Team screen can say Active', async () => {
    h.user = { id: SECRETARY_ID, email: 'info@yourdesignco.com' }
    await getActiveWorkspace()
    expect(h.accepted).toContain('member-1')
  })
})

// 4 + 5 ─────────────────────────────────────────────────────────────────────────────────────────────
describe('what the secretary can and cannot do', () => {
  beforeEach(() => { h.user = { id: SECRETARY_ID, email: 'info@yourdesignco.com' } })

  it('can operate the business', async () => {
    const ctx = await requireActiveBusinessContext()
    expect(ctx?.capabilities.canOperate).toBe(true)
  })

  it('cannot touch billing, settings, costs or the team', async () => {
    const ctx = await requireActiveBusinessContext()
    expect(ctx?.capabilities.canEditBilling).toBe(false)
    expect(ctx?.capabilities.canEditSettings).toBe(false)
    expect(ctx?.capabilities.canViewCosts).toBe(false)
    expect(ctx?.capabilities.canManageTeam).toBe(false)
  })

  it('acts as HERSELF, so the audit trail can name her', async () => {
    // created_by / order_events.actor are written from actorUserId — see lib/orders/store.ts.
    const ctx = await requireActiveBusinessContext()
    expect(ctx?.actorUserId).toBe(SECRETARY_ID)
    expect(ctx?.tenantId).toBe(YDC)
  })
})

// 6 ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('somebody from another business gets nothing here', () => {
  it('resolves to their own tenant, never Your Design Collective', async () => {
    h.user = { id: OUTSIDER_ID, email: 'someone@elsewhere.example' }
    const ws = await getActiveWorkspace()
    expect(ws.tenantId).toBe(OTHER_BIZ)
    expect(ws.tenantId).not.toBe(YDC)
  })
})

// 7 ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('removing her removes access immediately', () => {
  it('has no tenant the moment the membership stops being active', async () => {
    // deactivateMember flips status to 'disabled'; resolveMembership only ever selects status='active',
    // so the next request finds nothing. There is no session to expire and no cache to wait out.
    h.user = { id: SECRETARY_ID, email: 'info@yourdesignco.com' }
    h.activeMembership[SECRETARY_ID] = null
    const ws = await getActiveWorkspace()
    expect(ws.tenantId).toBeNull()
    expect(await requireActiveBusinessContext()).toBeNull()
  })

  it('gets nothing while the business itself is suspended', async () => {
    h.user = { id: SECRETARY_ID, email: 'info@yourdesignco.com' }
    h.tenantsById[YDC] = { id: YDC, business_name: 'Your Design Collective', white_label_partner_id: null, suspended_at: '2026-01-01T00:00:00Z' }
    expect((await getActiveWorkspace()).tenantId).toBeNull()
  })
})

// 8 ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('existing single-user customers are untouched', () => {
  it('a user who owns a tenant and has no membership row resolves exactly as before', async () => {
    h.user = { id: OWNER_ID, email: 'owner@ydc.example' }
    h.activeMembership = {}
    const ws = await getActiveWorkspace()
    expect(ws).toMatchObject({ tenantId: YDC, mode: 'owner', partnerId: null, role: 'owner' })
    const ctx = await requireActiveBusinessContext()
    expect(ctx?.capabilities).toEqual({
      canOperate: true, canEditBilling: true, canEditSettings: true, canViewCosts: true, canManageTeam: true,
    })
  })

  it('a signed-out visitor still resolves to nothing', async () => {
    h.user = null
    expect((await getActiveWorkspace()).tenantId).toBeNull()
  })

  it('survives the membership table not existing yet', async () => {
    // The migration is hand-run, so code ships before the table exists. An owner must be unaffected
    // and a would-be member must simply have no tenant — never a crash.
    h.user = { id: SECRETARY_ID, email: 'info@yourdesignco.com' }
    h.activeMembership[SECRETARY_ID] = null // what a 42P01 degrades to in resolveMembership
    expect((await getActiveWorkspace()).tenantId).toBeNull()
    h.user = { id: OWNER_ID, email: 'owner@ydc.example' }
    expect((await getActiveWorkspace()).tenantId).toBe(YDC)
  })
})

// 3 ─────────────────────────────────────────────────────────────────────────────────────────────────
// Asserted against the source, because the failure is a route DOING something rather than returning
// something, and the thing it must not do is write a tenants row.
describe('the secretary cannot accidentally create a second business', () => {
  const setup = readFileSync(new URL('../../app/api/auth/create-tenant/route.ts', import.meta.url), 'utf8')

  it('refuses anybody who is already an active member', () => {
    expect(setup).toContain('const membership = await resolveMembership(user.id)')
    expect(setup).toMatch(/if \(membership\)[\s\S]{0,200}status: 409/)
  })

  it('takes the user id from the session and never from the body', () => {
    // It used to read `userId` out of the POST body while sitting behind the public '/api/auth/'
    // prefix, so any caller could mint a business for any user id.
    expect(setup).toContain("const { data: { user } } = await supabase.auth.getUser()")
    expect(setup).not.toMatch(/const \{[^}]*userId[^}]*\} = await req\.json/)
    expect(setup).toContain('user_id: user.id')
  })

  it('still refuses an unauthenticated caller outright', () => {
    expect(setup).toMatch(/if \(!user\) return NextResponse\.json\([^)]*401/)
  })
})

// The ordering contract, asserted in both places it is written down ─────────────────────────────────
describe('SQL and TypeScript resolve in the same order', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/add_tenant_members.sql', import.meta.url), 'utf8')
  const ts = readFileSync(new URL('../workspace.ts', import.meta.url), 'utf8')

  it('get_tenant_id() checks ownership before membership', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION get_tenant_id'), sql.indexOf('tenant_member_role'))
    expect(fn.indexOf('FROM tenants')).toBeLessThan(fn.indexOf('FROM tenant_members'))
    expect(fn).toContain('COALESCE')
  })

  it('the resolver checks ownership before membership too', () => {
    expect(ts.indexOf("eq('user_id', user.id)")).toBeLessThan(ts.indexOf('resolveMembership(user.id)'))
  })

  it('both grant only on status = active', () => {
    expect(sql).toContain("status = 'active'")
    const members = readFileSync(new URL('./members.ts', import.meta.url), 'utf8')
    const resolve = members.slice(members.indexOf('export async function resolveMembership'))
    expect(resolve).toContain(".eq('status', 'active')")
  })

  it('locks the membership table to the server only', () => {
    // RLS enabled with no policies — the browser reaches nothing, exactly like business_invites.
    expect(sql).toContain('ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY')
    expect(sql).not.toMatch(/CREATE POLICY[^\n]*ON tenant_members/)
  })
})
