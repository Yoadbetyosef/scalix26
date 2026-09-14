import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { identifiesSomeone, resolveContactForOrder } from './link-contact'

// Every order belongs to a customer record. Tested with a tiny in-memory stand-in for the two
// queries the resolver makes, so the matching rule (email, then phone, never name) is pinned.
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

type Row = Record<string, unknown>
function fakeDb(contacts: Row[]) {
  const inserted: Row[] = []
  const chain = (rows: Row[]) => {
    const q = {
      _rows: rows,
      select() { return q }, eq() { return q }, is() { return q }, limit() { return Promise.resolve({ data: q._rows, error: null }) },
      or(expr: string) {
        // normalized_email.eq.x,email.ilike.x  |  normalized_phone.eq.x,phone.ilike.%x
        const m = /^(normalized_email|normalized_phone)\.eq\.([^,]+)/.exec(expr)
        const [, col, val] = m ?? []
        q._rows = rows.filter((r) => (r[col] as string) === val)
        return q
      },
      insert(row: Row) { inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: 'new-id' }, error: null }) }) } },
    }
    return q
  }
  return { db: { from: () => chain(contacts) } as never, inserted }
}

describe('identifiesSomeone', () => {
  it('needs a name, a company, an email or a phone', () => {
    expect(identifiesSomeone({})).toBe(false)
    expect(identifiesSomeone({ customerName: ' ' })).toBe(false)
    expect(identifiesSomeone({ customerCompany: 'M&P' })).toBe(true)
    expect(identifiesSomeone({ customerEmail: 'a@b.c' })).toBe(true)
    expect(identifiesSomeone({ customerPhone: '604 446 8438' })).toBe(true)
  })
})

describe('resolveContactForOrder', () => {
  it('keeps a picked contact', async () => {
    const { db, inserted } = fakeDb([])
    expect(await resolveContactForOrder(db, 't', { contactId: 'c1', customerName: 'x' })).toEqual({ contactId: 'c1', created: false, matched: false })
    expect(inserted).toHaveLength(0)
  })
  it('recognises the customer by email before creating anyone', async () => {
    const { db, inserted } = fakeDb([{ id: 'irina', normalized_email: 'anna.morozova@mpyachtcentre.com' }])
    const r = await resolveContactForOrder(db, 't', { customerName: 'Irina', customerEmail: 'Anna.Morozova@MPYachtCentre.com' })
    expect(r).toEqual({ contactId: 'irina', created: false, matched: true })
    expect(inserted).toHaveLength(0)
  })
  it('falls back to the phone, comparing the last ten digits', async () => {
    const { db } = fakeDb([{ id: 'garo', normalized_phone: '6045551234' }])
    const r = await resolveContactForOrder(db, 't', { customerName: 'Garo', customerPhone: '+1 (604) 555-1234' })
    expect(r.contactId).toBe('garo')
  })
  it('creates a contact from what was typed when nobody matches — company and person split', async () => {
    const { db, inserted } = fakeDb([])
    const r = await resolveContactForOrder(db, 't', { customerName: 'Dylan', customerCompany: 'LL Private Jewellers', customerEmail: 'info@ll.com' })
    expect(r).toEqual({ contactId: 'new-id', created: true, matched: false })
    expect(inserted[0]).toMatchObject({ tenant_id: 't', name: 'Dylan', company_name: 'LL Private Jewellers', email: 'info@ll.com', normalized_email: 'info@ll.com' })
  })
  it('never links on the name alone', async () => {
    const { db, inserted } = fakeDb([{ id: 'artin-1', name: 'Artin' }])
    const r = await resolveContactForOrder(db, 't', { customerName: 'Artin' })
    expect(r.matched).toBe(false)
    expect(r.created).toBe(true)
    expect(inserted).toHaveLength(1)
  })
  it('an order with nothing identifying gets no contact and creates none', async () => {
    const { db, inserted } = fakeDb([])
    expect((await resolveContactForOrder(db, 't', {})).contactId).toBeNull()
    expect(inserted).toHaveLength(0)
  })
})

describe('wired into the store, and the customer history reads both ways', () => {
  it('createOrder and updateOrder resolve the contact', () => {
    const s = src('lib/orders/store.ts')
    expect(s).toMatch(/const linked = await resolveContactForOrder\(sb, c\.tenantId, input\)/)
    expect(s).toMatch(/contact_id: linked\.contactId/)
    expect(s).toMatch(/resolveContactForOrder\(sb, c\.tenantId, patch\)/)
  })
  it('the history matches by contact_id OR the typed email/phone, and includes no-sale estimates', () => {
    const h = src('lib/customer/history.ts')
    expect(h).toMatch(/const filters = \[`contact_id\.eq\.\$\{contact\.id\}`\]/)
    expect(h).toMatch(/customer_email\.ilike/)
    expect(h).toMatch(/customer_phone\.ilike/)
    // No stage filter anywhere: closed, no-sale and cancelled are all history.
    expect(h).not.toMatch(/\.neq\('stage'|\.not\('stage'|\.in\('stage'/)
    expect(h).toMatch(/noSale: orders\.filter\(\(o\) => o\.group === 'no_sale'\)\.length/)
  })
  it('the contact page shows orders, payments, memos and appointments', () => {
    const p = src('app/contacts/[id]/page.tsx')
    for (const label of ['Orders &amp; estimates', 'Payments ·', 'Memos ·', 'Appointments ·']) expect(p).toContain(label)
  })
})
