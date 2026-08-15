import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { markLeadsBooked, OPEN_FOR_BOOKING } from './booked'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const bookRoute = read('../../app/api/appointments/book/route.ts')
const table = read('../../components/dashboard/leads-table.tsx')
const patchRoute = read('../../app/api/leads/[id]/route.ts')
const v2Leads = read('../../app/(v2)/v2/leads/page.tsx')

function fakeDb(leads: { id: string; phone: string | null; contact_id: string | null }[]) {
  const calls = { table: [] as string[], selectFilters: {} as Record<string, unknown>, updated: null as unknown, updatedIds: [] as string[] }
  let mode: 'select' | 'update' = 'select'
  let current = ''
  const chain: Record<string, unknown> = {
    select() { mode = 'select'; return chain },
    update(p: unknown) { mode = 'update'; if (current === 'leads') calls.updated = p; return chain },
    // Scoped to `leads`: the drip brake runs through the same fake afterwards, and letting its own
    // select overwrite these made the assertion read 'active'.
    eq(c: string, v: unknown) { if (mode === 'select' && current === 'leads') calls.selectFilters[c] = v; return chain },
    in(c: string, v: string[]) { if (mode === 'select') { if (current === 'leads') calls.selectFilters[c] = v } else if (current === 'leads') calls.updatedIds = v; return chain },
    then(resolve: (v: unknown) => void) {
      const rows = current === 'leads' ? leads : []
      return Promise.resolve(mode === 'select' ? { data: rows, error: null } : { error: null }).then(resolve)
    },
  }
  return { db: { from(t: string) { current = t; calls.table.push(t); return chain } } as never, calls }
}

describe('an appointment books the lead', () => {
  it('moves the open ones and leaves dismissed alone', async () => {
    // "Not a customer" is a judgement somebody made. A later booking must not silently overturn it.
    expect([...OPEN_FOR_BOOKING]).toEqual(['new', 'contacted', 'called_back'])
    const { db, calls } = fakeDb([{ id: 'a', phone: '+15550123456', contact_id: 'c1' }])
    await markLeadsBooked(db, 't1', 'c1', '+15550123456')
    expect(calls.selectFilters.status).toEqual(['new', 'contacted', 'called_back'])
    expect(calls.updated).toEqual({ status: 'booked' })
    expect(calls.updatedIds).toEqual(['a'])
  })

  it('matches by contact first, and by the last ten digits otherwise', async () => {
    const { db, calls } = fakeDb([
      { id: 'byContact', phone: null, contact_id: 'c1' },
      { id: 'byPhone', phone: '(555) 012-3456', contact_id: null },
      { id: 'someoneElse', phone: '+15559998888', contact_id: 'c2' },
    ])
    const res = await markLeadsBooked(db, 't1', 'c1', '+15550123456')
    expect(res.ids.sort()).toEqual(['byContact', 'byPhone'])
    expect(res.ids).not.toContain('someoneElse')
  })

  it('stops the follow-ups too, rather than waiting a day for the cron to notice', async () => {
    const { db, calls } = fakeDb([{ id: 'a', phone: '+15550123456', contact_id: 'c1' }])
    await markLeadsBooked(db, 't1', 'c1', '+15550123456')
    expect(calls.table).toContain('drip_campaigns')
  })

  it('does nothing without something to match on', async () => {
    const { db } = fakeDb([{ id: 'a', phone: '+15550123456', contact_id: 'c1' }])
    expect(await markLeadsBooked(db, 't1', null, null)).toEqual({ marked: 0, ids: [] })
    expect(await markLeadsBooked(db, '', 'c1', '+15550123456')).toEqual({ marked: 0, ids: [] })
  })

  it('never unbooks a customer — a failure here is swallowed', async () => {
    const exploding = { from: () => { throw new Error('boom') } } as never
    await expect(markLeadsBooked(exploding, 't1', 'c1', '+15550123456')).resolves.toEqual({ marked: 0, ids: [] })
  })
})

describe('nothing is left for a human to remember', () => {
  it('the booking route derives it, after the appointment is written', () => {
    expect(bookRoute).toContain('await markLeadsBooked(supabase, tenant.id, contactId, phone)')
    expect(bookRoute.indexOf("from('appointments').insert(")).toBeLessThan(bookRoute.indexOf('markLeadsBooked(supabase'))
  })

  it('the button is gone from both screens', () => {
    expect(table).not.toContain("updateStatus(e, lead.id, 'booked')")
    expect(table).not.toMatch(/>\s*Mark as Booked/)
    expect(v2Leads).not.toContain("label: 'Mark as Booked'")
  })

  it('Dismiss and Restore stay — those are judgements, not facts', () => {
    expect(table).toContain("updateStatus(e, lead.id, 'dismissed')")
    expect(table).toContain("updateStatus(e, lead.id, 'contacted')")
  })

  it('the status guard now agrees with the column it writes to', () => {
    // It accepted 'qualified' and 'lost' — both forbidden by leads_status_check, so both would pass
    // the guard and fail at the database — and rejected 'called_back', which the constraint allows.
    expect(patchRoute).toContain("['new', 'contacted', 'booked', 'called_back', 'dismissed'].includes(status)")
    // The GUARD, not the file: the comment above it names the two it used to accept, and should.
    const guard = patchRoute.split('\n').find((l) => l.includes('includes(status)'))!
    expect(guard).not.toContain("'qualified'")
    expect(guard).not.toContain("'lost'")
    expect(patchRoute).toContain("if (['booked', 'dismissed'].includes(status))")
  })
})
