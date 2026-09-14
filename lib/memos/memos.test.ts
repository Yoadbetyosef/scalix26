import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MEMO_STATUSES, canMemoTransition, isMemoSettled, memoOverdue, memoStatusLabel } from './types'

// Send a stock item on memo → it is unavailable. Return it → available again. A supplier's piece
// returned → gone from stock. The pure rules here; the stock effects are asserted against the store's
// source, because they are the whole point and must not be refactored away by accident.
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('memo statuses', () => {
  it('read differently by direction, because the same status means opposite things', () => {
    expect(memoStatusLabel('open', 'out')).toBe('Sent on memo')
    expect(memoStatusLabel('open', 'in')).toBe('Received on memo')
    expect(memoStatusLabel('open', 'in', 'consignment')).toBe('Received on consignment')
    expect(memoStatusLabel('returned', 'out')).toBe('Returned to us')
    expect(memoStatusLabel('returned', 'in')).toBe('Returned to supplier')
    expect(memoStatusLabel('follow_up', 'out')).toBe('Follow up needed')
    expect(memoStatusLabel('pending_decision', 'in')).toBe('Pending decision')
  })
  it('sold and returned are endings; everything else may move anywhere', () => {
    for (const s of MEMO_STATUSES) {
      if (isMemoSettled(s)) for (const t of MEMO_STATUSES) expect(canMemoTransition(s, t), `${s} → ${t}`).toBe(false)
      else for (const t of MEMO_STATUSES) expect(canMemoTransition(s, t), `${s} → ${t}`).toBe(s !== t)
    }
  })
  it('flags an open memo past its follow-up date', () => {
    expect(memoOverdue({ status: 'open', dueOn: '2026-01-01' }, '2026-02-01')).toBe(true)
    expect(memoOverdue({ status: 'returned', dueOn: '2026-01-01' }, '2026-02-01')).toBe(false)
    expect(memoOverdue({ status: 'open', dueOn: null }, '2026-02-01')).toBe(false)
  })
})

describe('the stock follows the memo — asserted against the store', () => {
  const s = src('lib/memos/store.ts')
  it('ownership is a column set at creation, never inferred from status', () => {
    expect(s).toMatch(/owner: input\.direction === 'out' \? 'company' : 'counterparty'/)
    expect(s).toMatch(/ownership: kind === 'consignment' \? 'consignment' : 'memo_in'/)
  })
  it('sending OUR piece out moves it from its location onto memo, and refuses to send what is not there', () => {
    expect(s).toMatch(/moveStockForMemo\(c\.tenantId, productId, qty, loc, 1, 'memo_out'/)
    expect(s).toMatch(/if \(q\[loc\] < qty\) return \{ ok: false, error: `Only \$\{q\[loc\]\} in \$\{loc\}/)
    // A piece that is itself on memo from a supplier cannot be sent out as ours.
    expect(s).toMatch(/p\.ownership && p\.ownership !== 'owned'/)
    // If the stock cannot leave, the memo does not exist either.
    expect(s).toMatch(/await db\.from\('memos'\)\.delete\(\)\.eq\('id', memo\.id\)/)
  })
  it('a returned OUT memo puts the piece back into a location', () => {
    expect(s).toMatch(/m\.direction === 'out' && input\.to === 'returned'[\s\S]*?moveStockForMemo\(c\.tenantId, m\.catalogProductId, m\.quantity, loc, -1, 'memo_return'/)
  })
  it('a returned IN memo zeroes the supplier piece and archives it — it was never ours', () => {
    expect(s).toMatch(/m\.direction === 'in' && input\.to === 'returned'[\s\S]*?showroom_quantity: 0, warehouse_quantity: 0, storage_quantity: 0, availability_status: 'out_of_stock', archived_at/)
    expect(s).toMatch(/movement_type: 'memo_return_supplier'/)
  })
  it('a sale writes a sell movement in either direction and never touches a status without stock', () => {
    expect(s).toMatch(/m\.direction === 'out' && input\.to === 'sold'[\s\S]*?movement_type: 'sell'/)
    expect(s).toMatch(/m\.direction === 'in' && input\.to === 'sold'[\s\S]*?movement_type: 'sell'/)
  })
  it('the status is an optimistic lock, and a failed stock move puts it back', () => {
    // No transaction spans memo + catalog. The status write is conditional on the status this call
    // read, so a double-tap or a retry moves no stock twice; every stock failure reverts it.
    expect(s).toMatch(/\.update\(patch\)\s*\n\s*\.eq\('tenant_id', c\.tenantId\)\.eq\('id', id\)\.eq\('status', m\.status\)/)
    expect(s).toMatch(/if \(!locked\?\.length\) return \{ ok: false/)
    expect((s.match(/return revert\(/g) ?? []).length).toBeGreaterThanOrEqual(4)
    // A supplier piece entered a moment ago is removed again if the memo itself does not land.
    expect(s).toMatch(/if \(input\.direction === 'in' && productId && !input\.catalogProductId\) \{[\s\S]*?from\('catalog_products'\)\.delete\(\)/)
  })
  it('every transition is on the memo history', () => {
    expect(s).toMatch(/addMemoEvent\(c\.tenantId, id, 'status_changed'/)
  })
})
