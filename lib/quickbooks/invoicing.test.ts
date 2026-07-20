import { describe, it, expect } from 'vitest'
import { buildQBInvoicePayload } from './invoicing'

describe('buildQBInvoicePayload (proposal lines → QuickBooks invoice)', () => {
  const lines = [
    { description: 'Sofa', quantity: 2, unit_price_cents: 50000, line_total_cents: 100000 },
    { description: null, quantity: 1, unit_price_cents: 19900, line_total_cents: 19900 },
  ]
  const payload = buildQBInvoicePayload(lines, 'CUST-1', 'ITEM-9', 'PROP-0007')

  it('references the customer + carries the doc number', () => {
    expect((payload.CustomerRef as { value: string }).value).toBe('CUST-1')
    expect(payload.DocNumber).toBe('PROP-0007')
  })
  it('maps each line with cents→dollars, qty, unit price, and the item ref', () => {
    const L = payload.Line as Array<Record<string, unknown>>
    expect(L).toHaveLength(2)
    expect(L[0].Amount).toBe(1000)                                  // 100000 cents → $1000
    expect(L[0].Description).toBe('Sofa')
    const d0 = L[0].SalesItemLineDetail as { ItemRef: { value: string }; Qty: number; UnitPrice: number }
    expect(d0.ItemRef.value).toBe('ITEM-9'); expect(d0.Qty).toBe(2); expect(d0.UnitPrice).toBe(500)
    expect(L[1].Amount).toBe(199)                                   // 19900 cents → $199
    expect(L[1].Description).toBeUndefined()                        // null description omitted
  })
  it('omits DocNumber when not provided', () => { expect(buildQBInvoicePayload(lines, 'C', 'I').DocNumber).toBeUndefined() })
})
