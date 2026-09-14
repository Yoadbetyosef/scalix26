import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { lineInsert, lineExtras, lineRow, orderRow } from './rows'
import { emptyLine, lineFromSaved, lineToPayload, type LineDraft } from '@/components/orders/line-item-fields'
import { lineItemSchema, patchOrderSchema } from './schema'
import type { LineItemInput } from './types'

// ── "IT STOPPED SAVING THE BRACELET, THE QUALITY AND THE PRICE" ─────────────────────────────────
//
// The report was one sentence and the causes were four, in four layers: a line dropped on the client
// because it had no name; a drawer that re-sent hour-old state; a balance recomputed as if the
// deposit were zero; and two items sharing one set of control ids. Each layer now has a test that
// pushes a fully-specified jewellery line through it and asserts nothing is lost. A field that
// starts vanishing again fails here, by name, before anyone types it three times.

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/** Every field on the form, filled in — a bracelet, because that is the piece that was reported. */
const bracelet: LineDraft = {
  ...emptyLine(),
  productType: 'Bracelet', productName: 'Tennis bracelet 7"', description: 'Four-prong, box clasp', sku: 'TB-401',
  quantity: '1', unitPrice: '4850.00', internalCost: '2100.00',
  measurements: "7''", color: 'High polish', material: '', customSpec: 'Safety catch',
  stoneType: 'Diamond', stoneOrigin: 'Natural', stoneQuality: 'VS1', stoneColor: 'G',
  centerStoneShape: 'Round', sideStoneShape: 'Round', metalKarat: '14K White Gold',
  centerStoneCarat: '5.25', sideStoneCaratTotal: '',
  certificateLab: 'GIA', ringSize: '',
  sideStoneShapes: ['Round', 'Baguette'], bandWidthMm: '3.5',
}

describe('the form → API payload → validation → row → object round trip loses nothing', () => {
  const payload = lineToPayload(bracelet)

  it('the payload carries every jewellery field the form holds', () => {
    expect(payload.productType).toBe('Bracelet')
    expect(payload.stoneQuality).toBe('VS1')
    expect(payload.unitPriceCents).toBe(485000)
    expect(payload.internalCostCents).toBe(210000)
    expect(payload.centerStoneCarat).toBe(5.25)
    expect(payload.sideStoneShapes).toEqual(['Round', 'Baguette'])
    expect(payload.sideStoneShape).toBe('Round')
    expect(payload.bandWidthMm).toBe(3.5)
    expect(payload.measurements).toBe("7''")
    expect(payload.metalKarat).toBe('14K White Gold')
    expect(payload.certificateLab).toBe('GIA')
  })

  it('the server schema accepts the payload without stripping a field', () => {
    const parsed = lineItemSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    // zod's object() strips unknown keys silently — so a key the schema forgot would vanish here
    // with no error. Every key the form sends must survive.
    for (const k of Object.keys(payload)) expect(parsed.data, k).toHaveProperty(k)
    expect(parsed.data).toEqual(payload)
  })

  it('the whole PATCH body survives validation, line items included', () => {
    const body = patchOrderSchema.safeParse({ customerName: 'Irina', lineItems: [payload], taxChoiceId: 'BC:combined', orderKind: 'custom', kindDetails: {} })
    expect(body.success).toBe(true)
    if (body.success) expect(body.data.lineItems?.[0]).toEqual(payload)
  })

  it('the row written and the row read agree on every column', () => {
    const input = payload as LineItemInput
    const written = { ...lineInsert('tenant', 'order', input, 485000, 0), ...lineExtras(input), id: 'line-1', created_at: 'now' }
    const back = lineRow(written as unknown as Record<string, unknown>)
    // Every LineItemInput key has a column and comes back with the same value.
    expect(back.productType).toBe('Bracelet')
    expect(back.productName).toBe('Tennis bracelet 7"')
    expect(back.stoneQuality).toBe('VS1')
    expect(back.stoneColor).toBe('G')
    expect(back.stoneOrigin).toBe('Natural')
    expect(back.stoneType).toBe('Diamond')
    expect(back.unitPriceCents).toBe(485000)
    expect(back.internalCostCents).toBe(210000)
    expect(back.centerStoneCarat).toBe(5.25)
    expect(back.sideStoneCaratTotal).toBeNull()
    expect(back.sideStoneShapes).toEqual(['Round', 'Baguette'])
    expect(back.sideStoneShape).toBe('Round')
    expect(back.bandWidthMm).toBe(3.5)
    expect(back.measurements).toBe("7''")
    expect(back.metalKarat).toBe('14K White Gold')
    expect(back.certificateLab).toBe('GIA')
    expect(back.customSpec).toBe('Safety catch')
    expect(back.lineTotalCents).toBe(485000)
  })

  it('rehydrating the saved line into the form gives back what was typed', () => {
    const input = payload as LineItemInput
    const written = { ...lineInsert('tenant', 'order', input, 485000, 0), ...lineExtras(input), id: 'line-1', created_at: 'now' }
    const draft = lineFromSaved(lineRow(written as unknown as Record<string, unknown>))
    // Numbers come back as the same numbers; strings as the same strings.
    expect({ ...draft, unitPrice: Number(draft.unitPrice), internalCost: Number(draft.internalCost), centerStoneCarat: Number(draft.centerStoneCarat), bandWidthMm: Number(draft.bandWidthMm) })
      .toEqual({ ...bracelet, unitPrice: 4850, internalCost: 2100, centerStoneCarat: 5.25, bandWidthMm: 3.5 })
  })

  it('every LineItemInput key the schema knows is written by lineInsert or lineExtras', () => {
    // The mapping test above checks values; this checks NAMES, so a new field added to the schema
    // without a column mapping fails here rather than being accepted and dropped.
    const keys = Object.keys(lineItemSchema.shape)
    const written = { ...lineInsert('t', 'o', { productName: 'x' }, 0, 0), ...lineExtras({ productName: 'x' }) }
    const columns = new Set(Object.keys(written))
    const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    for (const k of keys) {
      // productRef → product_ref, sideStoneShapes → side_stone_shapes, etc.
      expect(columns.has(snake(k)), `${k} has no column`).toBe(true)
    }
  })
})

describe('the order row reads what the order writes', () => {
  it('reads kind, company and the tax snapshot, with sane fallbacks for an unmigrated row', () => {
    const o = orderRow({ id: 'o', tenant_id: 't', order_number: 'ORD-1', stage: 'new', subtotal_cents: 100, deposit_cents: 25, balance_cents: 75, created_at: 'a', updated_at: 'b' })
    expect(o.orderKind).toBe('custom')
    expect(o.kindDetails).toEqual({})
    expect(o.customerCompany).toBeNull()
    expect(o.depositCents).toBe(25)
    const r = orderRow({ id: 'o', tenant_id: 't', order_number: 'ORD-1', stage: 'in_process', order_kind: 'repair', kind_details: { repairRequested: 'Re-tip prongs' }, customer_company: 'M&P', created_at: 'a', updated_at: 'b' })
    expect(r.orderKind).toBe('repair')
    expect(r.kindDetails?.repairRequested).toBe('Re-tip prongs')
    expect(r.customerCompany).toBe('M&P')
    expect(r.stage).toBe('in_process')
  })
})

describe('the four layers that made a save silently lose data', () => {
  it('1 — the edit drawer rebuilds its state from the current order every time it opens', () => {
    const s = src('components/orders/order-edit.tsx')
    expect(s).toMatch(/const openDrawer = \(\) => \{[\s\S]*?setLines\(fresh\.lines\)[\s\S]*?setF\(fieldsFromInitial\(\)\)/)
    expect(s).toMatch(/onClick=\{openDrawer\}/)
  })

  it('2 — re-saving line items keeps the deposit already on the order', () => {
    const s = src('lib/orders/store.ts')
    expect(s).not.toMatch(/balance_cents = subtotal - \(patch\.depositCents \?\? 0\)/)
    expect(s).toMatch(/'depositCents' in patch && patch\.depositCents !== undefined \? patch\.depositCents : Number\(cur\?\.deposit_cents \?\? 0\)/)
  })

  it('3 — two items on one order never share a control id', () => {
    const s = src('components/orders/line-item-fields.tsx')
    expect(s).not.toMatch(/id="li-/)
    expect(s).toMatch(/const p = `li\$\{index\}`/)
    // Both forms pass the index.
    // Not [^>]* — the onChange handler on the same tag contains "=>".
    expect(src('components/orders/order-edit.tsx')).toMatch(/<LineItemFields[\s\S]{0,200}?index=\{i\}/)
    expect(src('components/orders/order-form.tsx')).toMatch(/<LineItemFields[\s\S]{0,200}?index=\{i\}/)
  })

  it('4 — a filled-in line without a name is refused out loud, not dropped', () => {
    const s = src('components/orders/order-edit.tsx')
    expect(s).toMatch(/const nameless = namelessError\(lines\)\s*\n\s*if \(nameless\) \{ setErr\(nameless\); return \}/)
  })

  it('and the deposit is no longer typed into either form — money goes through the ledger', () => {
    expect(src('components/orders/order-edit.tsx')).not.toMatch(/depositAmount/)
    expect(src('components/orders/order-form.tsx')).not.toMatch(/depositAmount/)
  })
})
