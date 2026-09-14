import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

// ── LINE ITEM IDS ARE NOT STABLE. NOTHING MAY REMEMBER ONE. ─────────────────────────────────────
//
// updateOrder replaces an order's lines on every save (delete + insert, with a snapshot to roll
// back to), so a line's id changes each time the order is edited. That is known, documented in
// lib/orders/OUTSTANDING.md §9, and NOT being rewritten during release hardening. What this test
// guards is the consequence: no table may reference order_line_items.id, and no feature may store
// one — a purchase belongs to an ORDER, a memo to a PRODUCT, a certificate to an ATTACHMENT, a
// payment to an ORDER. The day something needs a per-line reference, the fix is an in-place upsert
// in updateOrder first, and this test is where that decision surfaces.
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('nothing references order_line_items.id', () => {
  it('no migration declares a foreign key to it', () => {
    const dir = new URL('../../supabase/migrations/', import.meta.url)
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.sql')) continue
      expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(/REFERENCES\s+order_line_items\s*\(/i)
    }
  })
  it('no order-side feature writes a line id anywhere', () => {
    for (const f of ['lib/orders/payments.ts', 'lib/orders/purchases.ts', 'lib/memos/store.ts', 'lib/orders/document-snapshot.ts', 'lib/orders/shares.ts', 'lib/orders/approvals.ts', 'lib/orders/attachments.ts']) {
      expect(read(f), f).not.toMatch(/line_item_id|lineItemId/)
    }
  })
  it('the replacement is still snapshot-protected, so the instability is the only cost', () => {
    const s = read('lib/orders/store.ts')
    expect(s).toMatch(/previousLines = /)
    expect(s).toMatch(/const restoreLines = async/)
  })
})
