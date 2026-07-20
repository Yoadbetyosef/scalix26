import { describe, it, expect } from 'vitest'
import { materialSnapshot, MATERIAL_STATUSES } from './materials'
import { resolveTerm } from './terminology'

describe('materialSnapshot (fabric copied onto proposal/order lines)', () => {
  const m = { id: 'm1', name: 'Impala Jungle 207', code: 'IMP-207', image_url: 'https://x/f.jpg', color: 'Green', composition: '100% Polyester', martindale: '40000', width: '140cm', weight: '320', status: 'in_stock', extra: 'ignored' }
  const s = materialSnapshot(m)
  it('captures the customer-relevant fields', () => {
    expect(s).toMatchObject({ fabric_id: 'm1', name: 'Impala Jungle 207', code: 'IMP-207', color: 'Green', composition: '100% Polyester', martindale: '40000', status: 'in_stock' })
  })
  it('is a self-contained copy (no live catalog reference beyond the id)', () => { expect(Object.keys(s)).not.toContain('extra') })
  it('exposes the four manual statuses', () => expect([...MATERIAL_STATUSES]).toEqual(['in_stock', 'low_stock', 'out_of_stock', 'discontinued']))
})

describe('generic terminology (Core stays generic; only the label changes)', () => {
  it('catalog + material default to Catalog/Materials', () => {
    expect(resolveTerm('catalog', {})).toBe('Catalog')
    expect(resolveTerm('material', {}, { plural: true })).toBe('Materials')
  })
  it('a furniture tenant relabels them to Inventory / Fabrics without any schema change', () => {
    const o = { catalog: { singular: 'Inventory', plural: 'Inventory' }, material: { singular: 'Fabric', plural: 'Fabrics' }, variant: { singular: 'Configuration', plural: 'Configurations' } }
    expect(resolveTerm('catalog', o)).toBe('Inventory')
    expect(resolveTerm('material', o, { plural: true })).toBe('Fabrics')
    expect(resolveTerm('variant', o, { plural: true })).toBe('Configurations')
  })
})
