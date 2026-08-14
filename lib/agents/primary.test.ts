import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { primaryAgent, agentByPersona, primaryOf } from './primary'

// A postgrest stand-in that reproduces the ONE behaviour this module exists for: `maybeSingle()`
// tolerates zero rows and errors on two. That rule is enforced client-side in
// @supabase/postgrest-js/src/PostgrestBuilder.ts — it returns PGRST116 with `data: null` when the
// response array holds more than one row — so it is reproducible here without a database.
//
// The last test in this file runs the OLD query shape through the same fake and asserts it nulls.
// If that test ever goes green for the wrong reason, the fake has stopped modelling the bug and the
// rest of the file proves nothing.

type Row = Record<string, unknown>

interface Result { data: Row | null; error: { code: string } | null }

class Query {
  private filters: Array<[string, unknown]> = []
  private orderCol: string | null = null
  private ascending = true
  private lim: number | null = null

  constructor(private readonly rows: Row[], private readonly seen: { limited: boolean }) {}

  select(_columns: string): this { return this }
  eq(column: string, value: unknown): this { this.filters.push([column, value]); return this }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderCol = column
    this.ascending = opts?.ascending !== false
    return this
  }
  limit(n: number): this { this.lim = n; this.seen.limited = true; return this }

  private matched(): Row[] {
    let out = this.rows.filter((r) => this.filters.every(([c, v]) => r[c] === v))
    if (this.orderCol) {
      const col = this.orderCol
      out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (this.ascending ? 1 : -1))
    }
    if (this.lim !== null) out = out.slice(0, this.lim)
    return out
  }

  async maybeSingle(): Promise<Result> {
    const rows = this.matched()
    if (rows.length > 1) return { data: null, error: { code: 'PGRST116' } }
    return { data: rows[0] ?? null, error: null }
  }
}

function fakeDb(rows: Row[]) {
  const seen = { limited: false }
  const db = { from: (_table: string) => new Query(rows, seen) }
  return { db: db as unknown as SupabaseClient, seen }
}

const agent = (over: Partial<Row> = {}): Row => ({
  id: 'a1', tenant_id: 't1', status: 'active', persona: 'rudi', created_at: '2026-01-01T00:00:00Z', name: 'Rudi', ...over,
})

describe('primaryAgent', () => {
  it('returns the tenant’s single active agent — the case that already worked', async () => {
    const { db } = fakeDb([agent()])
    expect(await primaryAgent(db, 't1', 'id, name')).toMatchObject({ id: 'a1' })
  })

  it('returns the OLDEST active agent when there are two — the regression Miles causes', async () => {
    const { db } = fakeDb([
      agent({ id: 'miles', name: 'Miles', persona: 'miles', created_at: '2026-08-13T00:00:00Z' }),
      agent({ id: 'rudi', name: 'Rudi', created_at: '2026-01-01T00:00:00Z' }),
    ])
    const found = await primaryAgent<{ id: string }>(db, 't1', 'id, name')
    expect(found?.id).toBe('rudi')
  })

  it('stays deterministic no matter what order the rows come back in', async () => {
    const rows = [
      agent({ id: 'b', created_at: '2026-03-01T00:00:00Z' }),
      agent({ id: 'a', created_at: '2026-01-01T00:00:00Z' }),
      agent({ id: 'c', created_at: '2026-06-01T00:00:00Z' }),
    ]
    for (const order of [rows, [...rows].reverse(), [rows[2], rows[0], rows[1]]]) {
      const { db } = fakeDb(order)
      expect((await primaryAgent<{ id: string }>(db, 't1', 'id'))?.id).toBe('a')
    }
  })

  it('never answers from a draft agent, even when it is the only one', async () => {
    const { db } = fakeDb([agent({ id: 'draft', status: 'draft' })])
    expect(await primaryAgent(db, 't1', 'id')).toBeNull()
  })

  it('prefers the active agent over an older draft', async () => {
    const { db } = fakeDb([
      agent({ id: 'old-draft', status: 'draft', created_at: '2025-01-01T00:00:00Z' }),
      agent({ id: 'live', status: 'active', created_at: '2026-01-01T00:00:00Z' }),
    ])
    expect((await primaryAgent<{ id: string }>(db, 't1', 'id'))?.id).toBe('live')
  })

  it('never crosses tenants', async () => {
    const { db } = fakeDb([agent({ id: 'theirs', tenant_id: 't2', created_at: '2020-01-01T00:00:00Z' })])
    expect(await primaryAgent(db, 't1', 'id')).toBeNull()
  })

  it('returns null rather than throwing when the tenant has no agent at all', async () => {
    const { db } = fakeDb([])
    expect(await primaryAgent(db, 't1', 'id')).toBeNull()
  })

  it('always bounds the query to one row, so PGRST116 is unreachable and not merely unlikely', async () => {
    const { db, seen } = fakeDb([agent()])
    await primaryAgent(db, 't1', 'id')
    expect(seen.limited).toBe(true)
  })
})

describe('agentByPersona', () => {
  it('finds the messages employee among several agents', async () => {
    const { db } = fakeDb([
      agent({ id: 'rudi', created_at: '2026-01-01T00:00:00Z' }),
      agent({ id: 'sarah', created_at: '2026-02-01T00:00:00Z' }),
      agent({ id: 'miles', persona: 'miles', created_at: '2026-08-01T00:00:00Z' }),
    ])
    expect((await agentByPersona<{ id: string }>(db, 't1', 'miles', 'id'))?.id).toBe('miles')
  })

  it('returns null when this tenant has no Miles', async () => {
    const { db } = fakeDb([agent()])
    expect(await agentByPersona(db, 't1', 'miles', 'id')).toBeNull()
  })

  it('does not care whether the persona agent is active — that is the caller’s question', async () => {
    const { db } = fakeDb([agent({ id: 'miles', persona: 'miles', status: 'draft' })])
    expect((await agentByPersona<{ id: string }>(db, 't1', 'miles', 'id'))?.id).toBe('miles')
  })
})

describe('the shape this module replaced', () => {
  it('nulls on a second active agent — the fault, reproduced', async () => {
    const { db } = fakeDb([
      agent({ id: 'rudi', created_at: '2026-01-01T00:00:00Z' }),
      agent({ id: 'miles', persona: 'miles', created_at: '2026-08-13T00:00:00Z' }),
    ])
    // Verbatim the old call: no ordering, no limit, straight to maybeSingle().
    const { data, error } = await (db as unknown as {
      from: (t: string) => {
        select: (c: string) => { eq: (a: string, b: unknown) => { eq: (a: string, b: unknown) => { maybeSingle: () => Promise<Result> } } }
      }
    })
      .from('ai_employees').select('id').eq('tenant_id', 't1').eq('status', 'active').maybeSingle()

    expect(data).toBeNull()
    expect(error?.code).toBe('PGRST116')
  })
})

describe('primaryOf — the same rule, for rows already loaded', () => {
  // The dashboard reads every agent in one query and picks one in JS. That pick used to be
  // `.find(active)` over an unordered result: fine with one agent, a coin toss with two — and it
  // decides the hero's name, its voice, its portrait and whose Business Brain loads. Rudi started
  // speaking in Miles's voice on the home screen the day Miles was hired.
  const a = { id: 'rudi', status: 'active', created_at: '2026-01-01T00:00:00Z' }
  const b = { id: 'miles', status: 'active', created_at: '2026-08-14T00:00:00Z' }

  it('gives the same answer whatever order the rows arrive in', () => {
    expect(primaryOf([a, b])?.id).toBe('rudi')
    expect(primaryOf([b, a])?.id).toBe('rudi')
  })

  it('agrees with primaryAgent: oldest ACTIVE, not oldest', () => {
    const draft = { id: 'old-draft', status: 'draft', created_at: '2025-01-01T00:00:00Z' }
    expect(primaryOf([draft, b, a])?.id).toBe('rudi')
  })

  it('falls back to the oldest row when none is active', () => {
    const d1 = { id: 'd1', status: 'draft', created_at: '2026-03-01T00:00:00Z' }
    const d2 = { id: 'd2', status: 'draft', created_at: '2026-01-01T00:00:00Z' }
    expect(primaryOf([d1, d2])?.id).toBe('d2')
  })

  it('does not mutate the caller’s array', () => {
    const rows = [b, a]
    primaryOf(rows)
    expect(rows[0].id).toBe('miles')
  })

  it('has nothing to say about an empty tenant', () => {
    expect(primaryOf([])).toBeUndefined()
    expect(primaryOf(null)).toBeUndefined()
  })
})
