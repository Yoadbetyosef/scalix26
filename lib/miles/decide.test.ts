import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// The delivery is the one thing a unit test must not really do: this module's job is deciding WHETHER
// to send, and the sending itself belongs to lib/messaging/send.ts (which is tested where it lives).
// Typed as the real DeliverResult so a mock cannot drift from the contract it stands in for.
const deliver = vi.fn<(...a: unknown[]) => Promise<{ delivered: boolean; error?: string; externalId?: string }>>(
  async () => ({ delivered: true, externalId: 'm1' }),
)
vi.mock('@/lib/messaging/send', () => ({ deliverToConversation: (...a: unknown[]) => deliver(...(a as [])) }))

const { applyDecision, byToken } = await import('./decide')
const { hashToken } = await import('@/lib/orders/approval-token')

// Same postgrest stand-in discipline as the other Miles tests: filters apply to updates, and an
// update that matches nothing returns no row — which is what makes the send guard real.

type Row = Record<string, unknown>

class Query {
  private filters: Array<[string, unknown]> = []
  private op: 'select' | 'update' = 'select'
  private payload: Row = {}
  constructor(private readonly rows: Row[]) {}
  select(_c: string): this { return this }
  eq(c: string, v: unknown): this { this.filters.push([c, v]); return this }
  order(): this { return this }
  limit(): this { return this }
  update(patch: Row): this { this.op = 'update'; this.payload = patch; return this }
  private matched(): Row[] { return this.rows.filter((r) => this.filters.every(([c, v]) => r[c] === v)) }
  private run(): Row[] {
    const hits = this.matched()
    if (this.op === 'update') for (const r of hits) Object.assign(r, this.payload)
    return hits
  }
  async maybeSingle() { const r = this.run(); return { data: r[0] ?? null, error: null } }
  async single() { const r = this.run(); return { data: r[0] ?? null, error: r.length ? null : { message: 'none' } } }
  then<T>(resolve: (v: { data: Row[]; error: null }) => T): T { return resolve({ data: this.run(), error: null }) }
}

const TOKEN = 'A'.repeat(43)

function fakeDb(over: Partial<Row> = {}) {
  const tables: Record<string, Row[]> = {
    held_drafts: [{
      id: 'd1', tenant_id: 't1', ai_employee_id: 'miles', conversation_id: 'c1', contact_id: 'p1',
      channel: 'sms', inbound_message_id: null, inbound_excerpt: 'how much?',
      body: 'It is $1,200.', sent_body: null, reasons: [], status: 'pending', created_by: 'ai',
      created_at: '2026-08-14T09:00:00Z', decided_at: null, decided_by: null, sent_message_id: null,
      decide_token_hash: hashToken(TOKEN), ...over,
    }],
    conversations: [{ id: 'c1', human_takeover: false }],
  }
  return { db: { from: (t: string) => new Query((tables[t] ??= [])) } as unknown as SupabaseClient, tables }
}

beforeEach(() => {
  deliver.mockReset()
  deliver.mockResolvedValue({ delivered: true, externalId: 'm1' })
})

describe('byToken', () => {
  it('finds the draft the link belongs to', async () => {
    const { db } = fakeDb()
    expect((await byToken(db, TOKEN))?.id).toBe('d1')
  })

  it('never queries on a token that is not even token-shaped', async () => {
    const { db } = fakeDb()
    for (const junk of ['', 'x', '../../etc/passwd', 'select 1']) {
      expect(await byToken(db, junk)).toBeNull()
    }
  })

  it('does not match a different token', async () => {
    const { db } = fakeDb()
    expect(await byToken(db, 'B'.repeat(43))).toBeNull()
  })
})

describe('a token used twice sends once', () => {
  it('delivers on the first decision and refuses the second', async () => {
    const { db } = fakeDb()
    const first = await applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'link' })
    const second = await applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'link' })

    expect(first).toMatchObject({ ok: true, status: 'sent' })
    expect(second).toMatchObject({ ok: false, code: 'already' })
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('holds that line even when both taps arrive together', async () => {
    // Two requests, no await between them — the link opened on a phone and a watch.
    const { db } = fakeDb()
    const [a, b] = await Promise.all([
      applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'link' }),
      applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'link' }),
    ])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('will not send a draft that was already handed over', async () => {
    const { db } = fakeDb({ status: 'handled' })
    expect(await applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'link' })).toMatchObject({ code: 'already' })
    expect(deliver).not.toHaveBeenCalled()
  })
})

describe('what actually goes out', () => {
  it('sends the draft as written when it was not edited', async () => {
    const { db } = fakeDb()
    await applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'u1' })
    expect(deliver).toHaveBeenCalledWith('t1', 'c1', 'It is $1,200.')
  })

  it('sends the edit, and records it as what went out', async () => {
    const { db, tables } = fakeDb()
    const out = await applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'u1', body: 'It is £950.' })
    expect(out).toMatchObject({ ok: true, edited: true })
    expect(deliver).toHaveBeenCalledWith('t1', 'c1', 'It is £950.')
    expect(tables.held_drafts[0]).toMatchObject({ sent_body: 'It is £950.', body: 'It is $1,200.' })
  })

  it('treats an edit identical to the draft as not an edit', async () => {
    const { db } = fakeDb()
    const out = await applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'u1', body: 'It is $1,200.' })
    expect(out).toMatchObject({ ok: true, edited: false })
  })
})

describe('a delivery that fails leaves the draft waiting', () => {
  it('reverts the claim rather than claiming a send that never happened', async () => {
    deliver.mockResolvedValue({ delivered: false, error: 'No phone number on file.' })
    const { db, tables } = fakeDb()

    const out = await applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'link' })
    expect(out).toMatchObject({ ok: false, code: 'delivery' })
    expect(out.ok === false && out.message).toContain('No phone number on file.')

    // Pending is the truthful state for a reply the customer did not receive.
    expect(tables.held_drafts[0]).toMatchObject({ status: 'pending', sent_body: null, decided_at: null })
  })

  it('and it can be tried again afterwards', async () => {
    deliver.mockResolvedValueOnce({ delivered: false, error: 'Twilio 21610' })
    const { db } = fakeDb()
    await applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'link' })
    expect(await applyDecision(db, 't1', 'd1', 'send', { decidedBy: 'link' })).toMatchObject({ ok: true })
  })
})

describe('"I\'ll handle it"', () => {
  it('takes the conversation over, and sends nothing', async () => {
    const { db, tables } = fakeDb()
    const out = await applyDecision(db, 't1', 'd1', 'handle', { decidedBy: 'link' })
    expect(out).toMatchObject({ ok: true, status: 'handled' })
    expect(tables.conversations[0].human_takeover).toBe(true)
    expect(deliver).not.toHaveBeenCalled()
  })

  it('is decided once, like everything else here', async () => {
    const { db } = fakeDb()
    await applyDecision(db, 't1', 'd1', 'handle', { decidedBy: 'link' })
    expect(await applyDecision(db, 't1', 'd1', 'handle', { decidedBy: 'link' })).toMatchObject({ code: 'already' })
  })
})

describe('the tenant comes from the draft, never from the caller', () => {
  it('refuses a draft that belongs to somebody else', async () => {
    const { db } = fakeDb()
    expect(await applyDecision(db, 'other-tenant', 'd1', 'send', { decidedBy: 'link' })).toMatchObject({ code: 'not_found' })
    expect(deliver).not.toHaveBeenCalled()
  })
})
