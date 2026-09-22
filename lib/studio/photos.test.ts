import { describe, it, expect, vi } from 'vitest'
import { sanitizeProduct, sanitizeProductPatch, sanitizeVariant, MAX_PHOTOS, MAX_VARIANT_PHOTOS } from './sanitize'
import { ensureStudioForCatalog } from './link'
import { publicProductUrl } from './qr'

// ── The bug this suite exists for ────────────────────────────────────────────────────────────────
// Every one of a tenant's 15 studio products had photos = [], so /p/<token> rendered no <img> at
// all and every printed QR opened a picture-less page. The catalog image was seeded ONLY at insert,
// the studio row is created before staff photograph the piece, and syncStudioFromCatalog never
// mirrors photos. See seedPhotosIfEmpty in ./link.ts.

/** Minimal stand-in for the PostgREST builder chain ensureStudioForCatalog drives. */
function fakeDb(existing: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = []
  const inserts: Record<string, unknown>[] = []
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing }) }) }),
      }),
      insert: (row: Record<string, unknown>) => {
        inserts.push(row)
        return { select: () => ({ single: async () => ({ data: { ...row, id: 'new' } }) }) }
      },
      update: (patch: Record<string, unknown>) => {
        updates.push(patch)
        return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { ...existing, ...patch } }) }) }) }) }
      },
    }),
  }
  return { db: db as unknown as Parameters<typeof ensureStudioForCatalog>[0], updates, inserts }
}

const cat = (image_url: string | null) => ({ id: 'cat1', name: 'BERNARD DINING ARMCHAIR', price: 650, image_url })

describe('ensureStudioForCatalog seeds the photo whenever Studio has none', () => {
  it('backfills an EXISTING row whose photos are empty — the actual production bug', async () => {
    const { db, updates } = fakeDb({ id: 'sp1', photos: [], name: 'BERNARD' })
    const out = await ensureStudioForCatalog(db, 't1', cat('https://media.example.com/bernard.jpg'))
    expect(updates).toHaveLength(1)
    expect(updates[0].photos).toEqual(['https://media.example.com/bernard.jpg'])
    expect(out?.photos).toEqual(['https://media.example.com/bernard.jpg'])
  })

  it('NEVER touches a row that already has photos — Studio owns its list once it has one', async () => {
    const own = ['https://cdn.example.com/studio-a.jpg', 'https://cdn.example.com/studio-b.jpg']
    const { db, updates } = fakeDb({ id: 'sp1', photos: own })
    const out = await ensureStudioForCatalog(db, 't1', cat('https://media.example.com/bernard.jpg'))
    expect(updates).toHaveLength(0)
    expect(out?.photos).toEqual(own)   // order preserved: a re-seed would move the cover
  })

  it('does nothing when the catalog product has no image either', async () => {
    const { db, updates } = fakeDb({ id: 'sp1', photos: [] })
    await ensureStudioForCatalog(db, 't1', cat(null))
    expect(updates).toHaveLength(0)
  })

  it('still seeds at insert time when the image is already there', async () => {
    const { db, inserts } = fakeDb(null)
    await ensureStudioForCatalog(db, 't1', cat('https://media.example.com/x.jpg'))
    expect(inserts[0].photos).toEqual(['https://media.example.com/x.jpg'])
  })

  it('scopes the backfill write to the tenant', async () => {
    // The update chain is .eq('id').eq('tenant_id') — assert both links exist rather than trusting
    // the shape, because a service-role client makes a missing tenant filter a cross-tenant write.
    const eq2 = vi.fn(() => ({ select: () => ({ maybeSingle: async () => ({ data: { photos: ['u'] } }) }) }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'sp1', photos: [] } }) }) }) }),
        update: () => ({ eq: eq1 }),
      }),
    } as unknown as Parameters<typeof ensureStudioForCatalog>[0]
    await ensureStudioForCatalog(db, 't1', cat('https://u'))
    expect(eq1).toHaveBeenCalledWith('id', 'sp1')
    expect(eq2).toHaveBeenCalledWith('tenant_id', 't1')
  })
})

describe('photo list limits', () => {
  const many = Array.from({ length: 20 }, (_, i) => `https://x/${i}.jpg`)

  it('a PRODUCT keeps at most 8 — one cover plus seven', () => {
    expect(MAX_PHOTOS).toBe(8)
    expect(sanitizeProduct({ photos: many }).photos).toHaveLength(8)
  })

  it('a SUB-PRODUCT keeps its existing 12 — the 8 is the product requirement, not a limit', () => {
    expect(MAX_VARIANT_PHOTOS).toBe(12)
    expect(sanitizeVariant({ photos: many }).photos).toHaveLength(12)
  })

  it('preserves order, because photos[0] is the cover', () => {
    const p = sanitizeProduct({ photos: ['https://b.jpg', 'https://a.jpg'] })
    expect(p.photos).toEqual(['https://b.jpg', 'https://a.jpg'])
  })

  it('drops blanks and non-strings rather than storing an empty src', () => {
    expect(sanitizeProduct({ photos: ['https://a.jpg', '', '   ', null, 7, 'https://b.jpg'] }).photos)
      .toEqual(['https://a.jpg', 'https://b.jpg'])
  })
})

describe('price validation', () => {
  it('rejects a negative price to null instead of storing it', () => {
    expect(sanitizeProduct({ base_price: -650 }).base_price).toBeNull()
    expect(sanitizeVariant({ price: -1 }).price).toBeNull()
  })

  it('keeps 0 and positive values — 0 is a real price, not a missing one', () => {
    expect(sanitizeProduct({ base_price: 0 }).base_price).toBe(0)
    expect(sanitizeProduct({ base_price: 650 }).base_price).toBe(650)
    expect(sanitizeProduct({ base_price: '1234.56' }).base_price).toBe(1234.56)
  })

  it('treats junk and absence as no price', () => {
    expect(sanitizeProduct({ base_price: 'abc' }).base_price).toBeNull()
    expect(sanitizeProduct({}).base_price).toBeNull()
    expect(sanitizeProduct({ base_price: Infinity }).base_price).toBeNull()
  })
})

describe('a save cannot erase what the form does not edit', () => {
  // The guarantee now lives in the PATCH sanitizer, which is what the update route calls.
  // sanitizeProduct is the CREATE sanitizer and fills every column by design.
  it('the update path omits specs entirely when the caller did not send it', () => {
    // PATCH spreads this straight into .update(), so a key present here is a key written. An
    // unconditional specs:{} is what erased the spec table on every save from ProductForm.
    expect('specs' in sanitizeProductPatch({ name: 'x' })).toBe(false)
  })

  it('the update path writes specs when the caller does send it', () => {
    expect(sanitizeProductPatch({ specs: { Width: '80cm' } }).specs).toEqual({ Width: '80cm' })
  })

  it('the create path still fills specs, because an insert has no prior value to keep', () => {
    expect(sanitizeProduct({ name: 'x' }).specs).toEqual({})
  })
})

describe('the public URL is the product identity', () => {
  it('is built from the token, never an id — editing cannot rotate a printed QR', () => {
    expect(publicProductUrl('tok-123', 'https://app.example.com')).toBe('https://app.example.com/p/tok-123')
  })

  it('falls back to the request origin so a missing env var cannot print a bare path', () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(publicProductUrl('tok', 'https://app.scalix26.com')).toBe('https://app.scalix26.com/p/tok')
    if (prev !== undefined) process.env.NEXT_PUBLIC_APP_URL = prev
  })

  it('never doubles the slash when the base carries a trailing one', () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/'
    expect(publicProductUrl('tok')).toBe('https://app.example.com/p/tok')
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = prev
  })

  it('sanitizeProduct cannot set the token, the tenant, or the catalog link', () => {
    const out = sanitizeProduct({ qr_token: 'attacker', tenant_id: 'other', catalog_product_id: 'other', name: 'x' }) as Record<string, unknown>
    expect(out.qr_token).toBeUndefined()
    expect(out.tenant_id).toBeUndefined()
    expect(out.catalog_product_id).toBeUndefined()
  })
})
