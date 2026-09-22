import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sanitizeProduct, sanitizeProductPatch } from './sanitize'

// ── The staff/public decision on /p/[token] ─────────────────────────────────────────────────────
// The same URL serves a customer with no account and a signed-in member of the owning business.
// Everything below is about the one function that tells them apart, and about the PATCH shape that
// lets a second, smaller editor write to the same row without erasing the first editor's fields.

const h = vi.hoisted(() => ({ user: null as { email: string } | null, activeTenantId: null as string | null, tenant: null as Record<string, unknown> | null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.tenant }) }) }) }),
  }),
}))
vi.mock('@/lib/workspace', () => ({ getActiveTenantId: async () => h.activeTenantId }))

const { canEditStudioTenant } = await import('./viewer')

const YDC = '8041c0b5-c960-48bd-a3f7-655f5a0b6434'
const OTHER = 'cca31bcc-0000-0000-0000-000000000000'

beforeEach(() => {
  h.user = { email: 'staff@ydc.example' }
  h.activeTenantId = YDC
  h.tenant = { id: YDC, enabled_modules: ['studio', 'inventory'] }
})

describe('canEditStudioTenant', () => {
  it('lets a signed-in member of the owning business edit', async () => {
    expect(await canEditStudioTenant(YDC)).toBe(true)
  })

  it('REFUSES an anonymous visitor — the customer scanning the QR', async () => {
    h.user = null
    expect(await canEditStudioTenant(YDC)).toBe(false)
  })

  it('REFUSES a signed-in user whose active workspace is another business', async () => {
    h.activeTenantId = OTHER
    expect(await canEditStudioTenant(YDC)).toBe(false)
  })

  it('refuses a session with no tenant at all', async () => {
    h.activeTenantId = null
    expect(await canEditStudioTenant(YDC)).toBe(false)
  })

  it('refuses when the tenant does not have the studio module on', async () => {
    h.tenant = { id: YDC, enabled_modules: ['inventory'] }
    expect(await canEditStudioTenant(YDC)).toBe(false)
  })

  it('refuses when the tenant row cannot be read', async () => {
    h.tenant = null
    expect(await canEditStudioTenant(YDC)).toBe(false)
  })

  it('takes the tenant from its argument, never from the caller session', async () => {
    // The page passes the tenant the TOKEN resolved to. Staff of business A opening business B's
    // token must be a reader there, however the URL was reached.
    h.activeTenantId = YDC
    expect(await canEditStudioTenant(OTHER)).toBe(false)
  })
})

describe('sanitizeProductPatch — two editors, one row', () => {
  const STAFF_PANEL_SAVE = { photos: ['https://a.jpg'], description: 'Walnut, 80cm', base_price: 650 }

  it('writes only the keys the caller sent', () => {
    expect(Object.keys(sanitizeProductPatch(STAFF_PANEL_SAVE)).sort()).toEqual(['base_price', 'description', 'photos'])
  })

  it('does not touch supplier, notes, fabric, status or category', () => {
    // These have no control on the public page's panel. Under a full sanitize every one of them
    // would have been written as null (status reset to 'active') by a single Save.
    const out = sanitizeProductPatch(STAFF_PANEL_SAVE)
    for (const k of ['supplier_name', 'supplier_email', 'internal_notes', 'status', 'category',
                     'fabric_category', 'fabric_family', 'fabric_name', 'fabric_composition', 'fabric_durability', 'specs']) {
      expect(k in out, `${k} must not be written by a partial save`).toBe(false)
    }
  })

  it('still applies the same validation to what it does write', () => {
    expect(sanitizeProductPatch({ base_price: -5 }).base_price).toBeNull()
    expect(sanitizeProductPatch({ photos: Array.from({ length: 20 }, (_, i) => `https://x/${i}`) }).photos).toHaveLength(8)
  })

  it('writes an explicit null when the caller clears a field', () => {
    // Distinct from absence: sending description:null MUST clear it.
    const out = sanitizeProductPatch({ description: null })
    expect('description' in out).toBe(true)
    expect(out.description).toBeNull()
  })

  it('cannot be used to move the product, rotate its code, or relink it', () => {
    const out = sanitizeProductPatch({ tenant_id: OTHER, qr_token: 'x', catalog_product_id: 'y', id: 'z' })
    expect(Object.keys(out)).toEqual([])
  })

  it('the CREATE sanitizer still fills every column', () => {
    const out = sanitizeProduct({ name: 'Chair' })
    expect(out.name).toBe('Chair')
    expect(out.status).toBe('active')
    expect(out.photos).toEqual([])
    expect(out.supplier_name).toBeNull()
  })
})
