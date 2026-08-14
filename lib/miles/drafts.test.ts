import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hold, pending, markSent, markHandled } from './drafts'
import type { Commitment } from './autonomy'

// A postgrest stand-in that honours the two things this module depends on: filters apply to updates
// as well as reads (so `.eq('status','pending')` really is the idempotence guard), and an update that
// matches nothing returns no row.

type Row = Record<string, unknown>

class Query {
  private filters: Array<[string, unknown]> = []
  private orderCol: string | null = null
  private ascending = true
  private op: 'select' | 'insert' | 'update' = 'select'
  private payload: Row = {}

  constructor(private readonly rows: Row[], private readonly log: string[]) {}

  select(_c: string): this { return this }
  eq(column: string, value: unknown): this { this.filters.push([column, value]); return this }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderCol = column
    this.ascending = opts?.ascending !== false
    return this
  }
  insert(row: Row): this { this.op = 'insert'; this.payload = row; return this }
  update(patch: Row): this { this.op = 'update'; this.payload = patch; return this }

  private matched(): Row[] {
    let out = this.rows.filter((r) => this.filters.every(([c, v]) => r[c] === v))
    if (this.orderCol) {
      const col = this.orderCol
      out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (this.ascending ? 1 : -1))
    }
    return out
  }

  /** Applies the write and returns the affected rows. */
  private run(): Row[] {
    if (this.op === 'insert') {
      const created = { id: `d${this.rows.length + 1}`, ...this.payload }
      this.rows.push(created)
      this.log.push(`insert ${created.id}`)
      return [created]
    }
    if (this.op === 'update') {
      const hits = this.matched()
      for (const r of hits) Object.assign(r, this.payload)
      this.log.push(`update ${hits.length} -> ${JSON.stringify(this.payload.status ?? '')}`)
      return hits
    }
    return this.matched()
  }

  async single() { const r = this.run(); return { data: r[0] ?? null, error: r.length ? null : { message: 'no row' } } }
  async maybeSingle() { const r = this.run(); return { data: r[0] ?? null, error: null } }
  then<T>(resolve: (v: { data: Row[]; error: null }) => T): T { return resolve({ data: this.run(), error: null }) }
}

function fakeDb() {
  const tables: Record<string, Row[]> = { held_drafts: [], conversations: [{ id: 'c1', human_takeover: false }] }
  const log: string[] = []
  const db = { from: (t: string) => new Query((tables[t] ??= []), log) }
  return { db: db as unknown as SupabaseClient, tables, log }
}

const reasons: Commitment[] = [{ kind: 'price', evidence: '$1,200', source: 'reply' }]

const input = (over: Partial<Parameters<typeof hold>[1]> = {}) => ({
  tenantId: 't1', agentId: 'miles', conversationId: 'c1', contactId: 'p1',
  channel: 'instagram', body: 'That would be $1,200 including the setting.', reasons, ...over,
})

describe('hold', () => {
  it('writes the draft verbatim, pending, with its reasons', async () => {
    const { db } = fakeDb()
    const d = await hold(db, input())
    expect(d).toMatchObject({
      status: 'pending',
      body: 'That would be $1,200 including the setting.',
      ai_employee_id: 'miles',
      channel: 'instagram',
      created_by: 'ai',
    })
    expect(d?.reasons).toEqual(reasons)
  })

  it('keeps the customer’s words with the draft, so the notification can show what is answered', async () => {
    const { db } = fakeDb()
    const d = await hold(db, input({ inboundExcerpt: 'How much for the resize?' }))
    expect(d?.inbound_excerpt).toBe('How much for the resize?')
  })

  it('supersedes the pending draft on the same conversation rather than stacking two', async () => {
    // A second inbound means the first draft answers a stale question; approving it would put the
    // owner's name against the wrong message.
    const { db, tables } = fakeDb()
    const first = await hold(db, input({ body: 'First draft.' }))
    const second = await hold(db, input({ body: 'Second draft.' }))

    const rows = tables.held_drafts
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.id === first!.id)).toMatchObject({ status: 'replaced', decided_by: 'superseded' })
    expect(rows.find((r) => r.id === second!.id)).toMatchObject({ status: 'pending' })
  })

  it('never rewrites what was held — a superseded draft stays readable', async () => {
    const { db, tables } = fakeDb()
    const first = await hold(db, input({ body: 'First draft.' }))
    await hold(db, input({ body: 'Second draft.' }))
    expect(tables.held_drafts.find((r) => r.id === first!.id)?.body).toBe('First draft.')
  })

  it('leaves another conversation’s pending draft alone', async () => {
    const { db, tables } = fakeDb()
    await hold(db, input({ conversationId: 'c2' }))
    await hold(db, input({ conversationId: 'c1' }))
    expect(tables.held_drafts.filter((r) => r.status === 'pending')).toHaveLength(2)
  })
})

describe('pending', () => {
  it('returns what is waiting, oldest first — the order a queue is worked', async () => {
    const { db, tables } = fakeDb()
    await hold(db, input({ conversationId: 'a' }))
    await hold(db, input({ conversationId: 'b' }))
    tables.held_drafts[0].created_at = '2026-08-14T09:00:00Z'
    tables.held_drafts[1].created_at = '2026-08-14T08:00:00Z'

    const out = await pending(db, 't1')
    expect(out.map((d) => d.conversation_id)).toEqual(['b', 'a'])
  })

  it('does not return decided drafts', async () => {
    const { db } = fakeDb()
    const d = await hold(db, input())
    await markSent(db, 't1', d!.id, { decidedBy: 'u1' })
    expect(await pending(db, 't1')).toHaveLength(0)
  })
})

describe('markSent', () => {
  it('records what actually went out when the owner edited it', async () => {
    // A row saying "sent" without the words that were sent in the owner's name is the thing that
    // would destroy trust in this feature.
    const { db } = fakeDb()
    const d = await hold(db, input())
    const sent = await markSent(db, 't1', d!.id, { decidedBy: 'u1', sentBody: 'That would be £1,150.', messageId: 'm9' })

    expect(sent).toMatchObject({ status: 'sent', sent_body: 'That would be £1,150.', sent_message_id: 'm9', decided_by: 'u1' })
    expect(sent?.body).toBe('That would be $1,200 including the setting.')
  })

  it('sends once — a second tap on the same notification returns nothing', async () => {
    const { db } = fakeDb()
    const d = await hold(db, input())
    expect(await markSent(db, 't1', d!.id, { decidedBy: 'u1' })).not.toBeNull()
    expect(await markSent(db, 't1', d!.id, { decidedBy: 'u1' })).toBeNull()
  })

  it('cannot be sent from another tenant', async () => {
    const { db } = fakeDb()
    const d = await hold(db, input())
    expect(await markSent(db, 'other-tenant', d!.id, { decidedBy: 'u1' })).toBeNull()
  })
})

describe('markHandled — "I’ll handle it"', () => {
  it('takes the whole thread, not just this draft', async () => {
    // Without the takeover, declining a draft declines only THIS draft and the next message produces
    // another one — which is how every rejection becomes an edit.
    const { db, tables } = fakeDb()
    const d = await hold(db, input())
    const out = await markHandled(db, 't1', d!.id, 'u1')

    expect(out?.status).toBe('handled')
    expect(tables.conversations[0].human_takeover).toBe(true)
  })

  it('decides once', async () => {
    const { db } = fakeDb()
    const d = await hold(db, input())
    await markHandled(db, 't1', d!.id, 'u1')
    expect(await markHandled(db, 't1', d!.id, 'u1')).toBeNull()
  })

  it('does not take over a thread it did not decide', async () => {
    const { db, tables } = fakeDb()
    const d = await hold(db, input())
    await markSent(db, 't1', d!.id, { decidedBy: 'u1' })
    await markHandled(db, 't1', d!.id, 'u1')
    expect(tables.conversations[0].human_takeover).toBe(false)
  })
})
