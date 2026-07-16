import { describe, it, expect } from 'vitest'
import { hasCommercePermission, COMMERCE_PERMISSIONS } from './permissions'
import { computeBundleBuildable, availableOf } from './inventory'

describe('Commerce permissions (V1 owner = all; roles scaffolded)', () => {
  it('owner (null role) holds every permission', () => {
    for (const p of COMMERCE_PERMISSIONS) expect(hasCommercePermission(p, null)).toBe(true)
  })
  it('designer role is limited; cannot approve POs or create invoices', () => {
    expect(hasCommercePermission('catalog.view', 'designer')).toBe(true)
    expect(hasCommercePermission('commerce.create', 'designer')).toBe(true)
    expect(hasCommercePermission('purchase_orders.approve', 'designer')).toBe(false)
    expect(hasCommercePermission('quickbooks.invoice_create', 'designer')).toBe(false)
    expect(hasCommercePermission('inventory.adjust', 'designer')).toBe(false)
  })
  it('manager can approve POs + invoice but not adjust inventory or manage settings', () => {
    expect(hasCommercePermission('purchase_orders.approve', 'manager')).toBe(true)
    expect(hasCommercePermission('quickbooks.invoice_create', 'manager')).toBe(true)
    expect(hasCommercePermission('inventory.adjust', 'manager')).toBe(false)
    expect(hasCommercePermission('module.settings_manage', 'manager')).toBe(false)
  })
})

describe('Available = on_hand - reserved', () => {
  it('derives availability', () => {
    expect(availableOf(10, 3)).toBe(7)
    expect(availableOf(5, 5)).toBe(0)
  })
})

describe('Bundle availability is computed from components (§3, test #7)', () => {
  it('buildable = min over components of floor(available / perBundle); flags the limiting component', () => {
    // Milano 4-piece: 1× Left Arm, 2× Armless, 1× Corner. Stock: LA 3, Armless 5, Corner 2.
    const r = computeBundleBuildable([
      { itemKind: 'product', itemId: 'la', perBundle: 1, available: 3 },
      { itemKind: 'product', itemId: 'armless', perBundle: 2, available: 5 },
      { itemKind: 'product', itemId: 'corner', perBundle: 1, available: 2 },
    ])
    // sets: LA 3, Armless floor(5/2)=2, Corner 2 → buildable 2; Armless & Corner limiting.
    expect(r.buildable).toBe(2)
    expect(r.components.find((c) => c.itemId === 'armless')?.limiting).toBe(true)
    expect(r.components.find((c) => c.itemId === 'corner')?.limiting).toBe(true)
    expect(r.components.find((c) => c.itemId === 'la')?.limiting).toBe(false)
  })
  it('a fully out-of-stock component makes the bundle unbuildable', () => {
    expect(computeBundleBuildable([
      { itemKind: 'product', itemId: 'a', perBundle: 1, available: 4 },
      { itemKind: 'product', itemId: 'b', perBundle: 1, available: 0 },
    ]).buildable).toBe(0)
  })
  it('empty composition is not buildable', () => {
    expect(computeBundleBuildable([]).buildable).toBe(0)
  })
})
