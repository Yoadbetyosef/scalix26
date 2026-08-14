import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureMilesAgent } from './provision'
import { PERSONAS } from './index'

// A postgrest stand-in with just the four shapes this module uses: a filtered maybeSingle, a
// head+count, an ordered limit, and an insert…select…single. Same cardinality rule as the real
// client (see lib/agents/primary.test.ts for why that rule is the whole point).

type Row = Record<string, unknown>

class Query {
  private filters: Array<[string, unknown]> = []
  private orderCol: string | null = null
  private lim: number | null = null
  private headCount = false

  constructor(
    private readonly rows: Row[],
    private readonly onInsert: (row: Row) => Row,
  ) {}

  select(_c: string, opts?: { count?: string; head?: boolean }): this {
    this.headCount = opts?.head === true
    return this
  }
  eq(column: string, value: unknown): this { this.filters.push([column, value]); return this }
  order(column: string): this { this.orderCol = column; return this }
  limit(n: number): this { this.lim = n; return this }

  insert(row: Row): this {
    this.inserted = this.onInsert(row)
    return this
  }
  private inserted: Row | null = null

  private matched(): Row[] {
    let out = this.rows.filter((r) => this.filters.every(([c, v]) => r[c] === v))
    if (this.orderCol) {
      const col = this.orderCol
      out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])))
    }
    if (this.lim !== null) out = out.slice(0, this.lim)
    return out
  }

  async maybeSingle() {
    const rows = this.matched()
    if (rows.length > 1) return { data: null, error: { code: 'PGRST116' } }
    return { data: rows[0] ?? null, error: null }
  }

  async single() {
    if (this.inserted) return { data: this.inserted, error: null }
    const rows = this.matched()
    return { data: rows[0] ?? null, error: rows.length === 1 ? null : { code: 'PGRST116' } }
  }

  // `select(..., { head: true })` is awaited directly rather than terminated.
  then<T>(resolve: (v: { data: Row[] | null; count: number | null; error: null }) => T): T {
    const rows = this.matched()
    return resolve({ data: this.headCount ? null : rows, count: rows.length, error: null })
  }
}

function fakeDb(tables: { tenants: Row[]; ai_employees: Row[] }) {
  const inserts: Row[] = []
  const db = {
    from: (table: 'tenants' | 'ai_employees') =>
      new Query(tables[table], (row) => {
        const created = { id: 'new-agent', ...row }
        inserts.push(created)
        tables.ai_employees.push(created)
        return created
      }),
  }
  return { db: db as unknown as SupabaseClient, inserts }
}

const tenant = (over: Partial<Row> = {}): Row => ({ id: 't1', plan: 'pro', ...over })

const rudi = (over: Partial<Row> = {}): Row => ({
  id: 'rudi', tenant_id: 't1', status: 'active', persona: 'rudi', created_at: '2026-01-01T00:00:00Z',
  name: 'Rudi', business_name: 'TG Jewellers', industry: 'jewellery', website: 'tg.example',
  phone: '+15551234567', email: 'hi@tg.example', address: '1 Main St', city: 'Boston', state: 'MA',
  zip: '02108', business_hours: { mon: '9:00-17:00' }, timezone: 'America/New_York',
  greeting: 'Thanks for calling TG Jewellers!', forward_to_phone: '+15559998888',
  system_prompt: 'You answer the phone.', ...over,
})

describe('ensureMilesAgent', () => {
  it('creates the messages employee wearing the miles persona', async () => {
    const { db, inserts } = fakeDb({ tenants: [tenant()], ai_employees: [rudi()] })
    const result = await ensureMilesAgent(db, 't1')

    expect(result).toMatchObject({ ok: true, created: true })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      tenant_id: 't1',
      name: 'Miles',
      persona: 'miles',
      voice: PERSONAS.miles.voice,
      avatar_url: PERSONAS.miles.avatar,
      status: 'active',
    })
  })

  it('is never adoptable as somebody’s unfinished draft', async () => {
    const { db, inserts } = fakeDb({ tenants: [tenant()], ai_employees: [rudi()] })
    await ensureMilesAgent(db, 't1')
    // /api/agents/create reuses any setup_complete=false row — adopting Miles would rename him and
    // buy him a phone number.
    expect(inserts[0].setup_complete).toBe(true)
  })

  it('copies the business identity, because it describes the business and not the employee', async () => {
    const { db, inserts } = fakeDb({ tenants: [tenant()], ai_employees: [rudi()] })
    await ensureMilesAgent(db, 't1')
    expect(inserts[0]).toMatchObject({
      business_name: 'TG Jewellers',
      timezone: 'America/New_York',
      city: 'Boston',
      business_hours: { mon: '9:00-17:00' },
    })
  })

  it('copies nothing that belongs to the phone', async () => {
    const { db, inserts } = fakeDb({ tenants: [tenant()], ai_employees: [rudi()] })
    await ensureMilesAgent(db, 't1')
    expect(inserts[0].forward_to_phone).toBeUndefined()
    expect(inserts[0].greeting).toBeUndefined()
    expect(inserts[0].system_prompt).toBeUndefined()
  })

  it('returns the existing Miles rather than a second one', async () => {
    const miles = { id: 'miles', tenant_id: 't1', persona: 'miles', status: 'active', name: 'Miles', created_at: '2026-08-01T00:00:00Z' }
    const { db, inserts } = fakeDb({ tenants: [tenant()], ai_employees: [rudi(), miles] })
    const result = await ensureMilesAgent(db, 't1')

    expect(result).toMatchObject({ ok: true, created: false })
    expect(result.ok && result.agent.id).toBe('miles')
    expect(inserts).toHaveLength(0)
  })

  it('keeps a renamed Miles — the persona identifies him, not the name', async () => {
    const miles = { id: 'miles', tenant_id: 't1', persona: 'miles', status: 'active', name: 'Jordan', created_at: '2026-08-01T00:00:00Z' }
    const { db, inserts } = fakeDb({ tenants: [tenant()], ai_employees: [rudi(), miles] })
    const result = await ensureMilesAgent(db, 't1')
    expect(result.ok && result.agent.name).toBe('Jordan')
    expect(inserts).toHaveLength(0)
  })

  it('refuses on Starter — one employee, and Rudi already is it', async () => {
    const { db, inserts } = fakeDb({ tenants: [tenant({ plan: 'starter' })], ai_employees: [rudi()] })
    const result = await ensureMilesAgent(db, 't1')

    expect(result).toMatchObject({ ok: false, reason: 'plan_limit' })
    expect(result.ok === false && result.message).toContain('1 AI employee')
    expect(inserts).toHaveLength(0)
  })

  it('refuses on trial for the same reason', async () => {
    const { db, inserts } = fakeDb({ tenants: [tenant({ plan: 'trial' })], ai_employees: [rudi()] })
    expect(await ensureMilesAgent(db, 't1')).toMatchObject({ ok: false, reason: 'plan_limit' })
    expect(inserts).toHaveLength(0)
  })

  it('refuses on Pro once the three employees are used up', async () => {
    const { db } = fakeDb({
      tenants: [tenant({ plan: 'pro' })],
      ai_employees: [rudi(), rudi({ id: 'b' }), rudi({ id: 'c' })],
    })
    expect(await ensureMilesAgent(db, 't1')).toMatchObject({ ok: false, reason: 'plan_limit' })
  })

  it('does not invent a tenant', async () => {
    const { db } = fakeDb({ tenants: [], ai_employees: [] })
    expect(await ensureMilesAgent(db, 't1')).toMatchObject({ ok: false, reason: 'no_tenant' })
  })

  it('creates Miles for a tenant with no agent at all, without inventing an identity', async () => {
    const { db, inserts } = fakeDb({ tenants: [tenant()], ai_employees: [] })
    const result = await ensureMilesAgent(db, 't1')
    expect(result).toMatchObject({ ok: true, created: true })
    expect(inserts[0].business_name).toBeUndefined()
  })
})
