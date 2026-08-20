import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { metaPageChannel } from './page-token'

type Row = Record<string, unknown>

class Query {
  private filters: Array<[string, unknown]> = []
  private orderCol: string | null = null
  private ascending = true
  private lim: number | null = null
  constructor(private readonly rows: Row[]) {}
  select(_c: string): this { return this }
  eq(column: string, value: unknown): this { this.filters.push([column, value]); return this }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderCol = column; this.ascending = opts?.ascending !== false; return this
  }
  limit(n: number): this { this.lim = n; return this }
  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    let out = this.rows.filter((r) => this.filters.every(([c, v]) => r[c] === v))
    if (this.orderCol) {
      const col = this.orderCol
      out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (this.ascending ? 1 : -1))
    }
    if (this.lim !== null) out = out.slice(0, this.lim)
    return { data: out[0] ?? null, error: null }
  }
}
const fakeDb = (rows: Row[]) => ({ from: (_t: string) => new Query(rows) }) as unknown as SupabaseClient

const channel = (over: Partial<Row> = {}): Row => ({
  tenant_id: 't1', type: 'instagram', status: 'connected', ai_employee_id: 'a1',
  meta_page_id: 'page-1', credentials: { access_token: 'tok-tenant' },
  created_at: '2026-01-01T00:00:00Z', ...over,
})

describe('which page a tenant replies from', () => {
  it('uses the tenant’s own connected channel', async () => {
    const got = await metaPageChannel(fakeDb([channel()]), { tenantId: 't1', type: 'instagram', agentId: 'a1' })
    expect(got).toEqual({ token: 'tok-tenant', metaPageId: 'page-1' })
  })

  // The whole point. Before this, a missing token fell through to the PLATFORM's page token and the
  // tenant's customer got a reply from our business.
  it('returns null rather than borrowing another page when the channel has no token', async () => {
    const db = fakeDb([channel({ credentials: {} })])
    expect(await metaPageChannel(db, { tenantId: 't1', type: 'instagram', agentId: 'a1' })).toBeNull()
  })

  it('returns null when the tenant has no channel at all', async () => {
    expect(await metaPageChannel(fakeDb([]), { tenantId: 't1', type: 'instagram' })).toBeNull()
  })

  it('refuses a disconnected channel — the same rule the inbound webhook has always used', async () => {
    const db = fakeDb([channel({ status: 'disconnected' })])
    expect(await metaPageChannel(db, { tenantId: 't1', type: 'instagram', agentId: 'a1' })).toBeNull()
  })

  it('never reaches into another tenant’s channel', async () => {
    const db = fakeDb([channel({ tenant_id: 't2', credentials: { access_token: 'tok-other-tenant' } })])
    expect(await metaPageChannel(db, { tenantId: 't1', type: 'instagram' })).toBeNull()
  })

  it('does not answer Instagram with the Facebook page’s token', async () => {
    const db = fakeDb([channel({ type: 'facebook', credentials: { access_token: 'tok-fb' } })])
    expect(await metaPageChannel(db, { tenantId: 't1', type: 'instagram' })).toBeNull()
  })

  // The platform fallback, one level down: two agents in one tenant are two Pages, and the
  // conversation arrived on one of them.
  it('replies through the conversation’s own agent when the tenant has two', async () => {
    const db = fakeDb([
      channel({ ai_employee_id: 'a1', meta_page_id: 'page-1', credentials: { access_token: 'tok-a1' } }),
      channel({ ai_employee_id: 'a2', meta_page_id: 'page-2', credentials: { access_token: 'tok-a2' } }),
    ])
    expect(await metaPageChannel(db, { tenantId: 't1', type: 'instagram', agentId: 'a2' }))
      .toEqual({ token: 'tok-a2', metaPageId: 'page-2' })
  })

  it('falls back within the tenant only when the conversation names no agent', async () => {
    const db = fakeDb([channel({ ai_employee_id: 'a9', credentials: { access_token: 'tok-a9' } })])
    expect((await metaPageChannel(db, { tenantId: 't1', type: 'instagram' }))?.token).toBe('tok-a9')
  })
})

// Source-level, because the fallback's danger is that it is invisible: it looks like defensive
// coding and it sends a customer a message from the wrong business. A future hand re-adding
// `|| process.env.META_PAGE_ACCESS_TOKEN` to any send path has to delete this test to do it.
describe('no send path may fall back to the platform page token', () => {
  const SEND_PATHS = [
    'lib/messaging/send.ts',
    'app/api/conversations/[id]/send/route.ts',
    'app/api/webhooks/meta/instagram/route.ts',
    'lib/meta/page-token.ts',
  ]
  it('mentions META_PAGE_ACCESS_TOKEN nowhere except in a comment explaining its removal', () => {
    for (const path of SEND_PATHS) {
      const code = readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n')
      expect(code, path).not.toContain('META_PAGE_ACCESS_TOKEN')
    }
  })
})
