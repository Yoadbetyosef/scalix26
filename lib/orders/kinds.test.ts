import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ORDER_KINDS, ORDER_KIND_LABELS, APPRAISAL_PURPOSES, kindWords, isOrderKind } from './kinds'

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

// A repair and an appraisal are orders. Same customer history, same stages, same money.
describe('order kinds', () => {
  it('are four, and every existing row reads as custom', () => {
    expect([...ORDER_KINDS]).toEqual(['custom', 'repair', 'appraisal', 'stock'])
    for (const k of ORDER_KINDS) expect(ORDER_KIND_LABELS[k]).toBeTruthy()
    expect(isOrderKind(undefined)).toBe(false)
  })
  it('the appraisal purposes are the six the lab is asked for', () => {
    expect([...APPRAISAL_PURPOSES]).toEqual(['insurance', 'estate', 'value_confirmation', 'purchase_verification', 'sale_consideration', 'other'])
  })
  it('a repair speaks of the item brought in and what was asked; an appraisal of the item to appraise', () => {
    expect(kindWords('repair').brief).toBe('Repair requested')
    expect(kindWords('appraisal').piece).toBe('Item to appraise')
    expect(kindWords('custom').blurb).toBe('')
  })
  it('lives on the orders table — no second table, no second board, no second customer record', () => {
    const migration = src('supabase/migrations/add_tg_production_1.sql')
    expect(migration).toMatch(/ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_kind/)
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS repairs|CREATE TABLE IF NOT EXISTS appraisals/)
    expect(src('lib/orders/rows.ts')).toMatch(/orderKind: isOrderKind\(r\.order_kind\) \? r\.order_kind : 'custom'/)
  })
  it('both forms carry the kind and the document prints the piece brought in', () => {
    expect(src('components/orders/order-form.tsx')).toMatch(/<KindFields value=\{kind\}/)
    expect(src('components/orders/order-edit.tsx')).toMatch(/<KindFields value=\{kind\}/)
    expect(src('components/orders/document-body.tsx')).toMatch(/kindWords\(o\.orderKind\)\.piece/)
  })
})
