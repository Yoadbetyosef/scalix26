import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  PRODUCT_TYPE_OPTIONS, effectiveProductType, fieldFor, fieldsFor, productTypeKey,
} from './product-types'
import { JEWELRY_LIST_KEYS } from './option-templates'
import { specRows } from './documents'
import type { OrderLineItem } from './types'

describe('reading her words', () => {
  it('knows the eight the starter offers', () => {
    expect(PRODUCT_TYPE_OPTIONS.map(productTypeKey)).toEqual([
      'ring', 'band', 'earrings', 'pendant', 'necklace', 'tennis_necklace', 'bracelet', 'tennis_bracelet',
    ])
  })

  it('tests earrings BEFORE ring, because "earring" contains "ring"', () => {
    // The bug this ordering exists to prevent, asserted rather than commented.
    expect(productTypeKey('Diamond earrings')).toBe('earrings')
    expect(productTypeKey('Hoop')).toBe('earrings')
    expect(productTypeKey('Engagement ring')).toBe('ring')
  })

  it('survives her renaming a type, because it reads the words and not an id', () => {
    expect(productTypeKey('Riviera')).toBe('necklace')
    expect(productTypeKey('Tennis riviera')).toBe('tennis_necklace')
    expect(productTypeKey('Bangle')).toBe('bracelet')
    expect(productTypeKey('Eternity')).toBe('ring')
  })

  it('reads a tennis bracelet as a bracelet and not a necklace', () => {
    expect(productTypeKey('Tennis bracelet')).toBe('tennis_bracelet')
    expect(productTypeKey('Tennis')).toBe('tennis_necklace')   // documented: same field set either way
  })

  it('says nothing rather than guessing', () => {
    expect(productTypeKey('Anklet')).toBe('unspecified')
    expect(productTypeKey('')).toBe('unspecified')
    expect(productTypeKey(null)).toBe('unspecified')
    // A type it does not recognise gets the WHOLE form — today's behaviour, never something narrower.
    expect(fieldsFor('unspecified')).toEqual(fieldsFor('ring'))
  })

  // Her eighteen line items, by the names she actually typed.
  it('reads her real rows', () => {
    const seen = (name: string) => effectiveProductType({ productName: name })
    expect(seen('Solitaire ring')).toBe('ring')
    expect(seen('2 carat oval solitaire ')).toBe('ring')
    expect(seen('3 stone engagement ring ')).toBe('ring')
    expect(seen('Tennis necklace ')).toBe('tennis_necklace')
    expect(seen('bracellet')).toBe('bracelet')                    // her spelling, matched on "bracel"
    expect(seen('Luxe Tube Baguette Stretchy Bracelet')).toBe('bracelet')
    expect(seen('Deep Blue Bezel Lariat')).toBe('necklace')
    // Her misspelling still lands, because the word that decides it is the one she got right.
    expect(seen('Tennis Nechlase ')).toBe('tennis_necklace')
    // And the two it honestly cannot read: lines she named after their price. They keep the whole
    // form, which is what they have today.
    expect(seen('1000')).toBe('unspecified')
    expect(seen('3000')).toBe('unspecified')
  })

  it('lets her pick overrule what the name says', () => {
    expect(effectiveProductType({ productType: 'Pendant', productName: 'Solitaire ring' })).toBe('pendant')
    expect(effectiveProductType({ productType: '  ', productName: 'Solitaire ring' })).toBe('ring')
  })
})

describe('which fields a piece has', () => {
  it('leaves a ring exactly as it was', () => {
    const f = fieldsFor('ring')
    expect(f.ringSize?.label).toBe('Ring size')
    expect(f.centerStoneCarat?.label).toBe('Center weight (ct)')
    expect(f.measurements?.label).toBe('Measurements / size')
    expect(f.sideStoneCaratTotal?.label).toBe('Side total weight (ct)')
  })

  it('gives a pair of earrings no ring size and no CENTRE stone', () => {
    const f = fieldsFor('earrings')
    expect(f.ringSize).toBeUndefined()
    expect(f.centerStoneCarat?.label).toBe('Total weight, the pair (ct)')
    expect(f.centerStoneShape?.label).toBe('Stone shape')
  })

  it('gives a tennis piece a length and ONE total, and no sides at all', () => {
    for (const k of ['tennis_necklace', 'tennis_bracelet'] as const) {
      const f = fieldsFor(k)
      expect(f.ringSize).toBeUndefined()
      expect(f.sideStoneShape).toBeUndefined()
      expect(f.sideStoneCaratTotal).toBeUndefined()
      expect(f.centerStoneCarat?.label).toBe('Total weight (ct)')
      expect(f.measurements?.label).toBe('Length')
      expect(f.measurements?.list).toBe('length')
    }
  })

  it('gives a band its size and its width, and takes away the centre', () => {
    const f = fieldsFor('band')
    expect(f.ringSize?.label).toBe('Ring size')
    expect(f.measurements?.label).toBe('Width (mm)')
    expect(f.centerStoneCarat?.label).toBe('Total weight (ct)')
    expect(f.sideStoneCaratTotal).toBeUndefined()
  })

  it('gives a necklace and a bracelet a length, and keeps their centre stone', () => {
    for (const k of ['necklace', 'bracelet'] as const) {
      expect(fieldsFor(k).measurements?.label).toBe('Length')
      expect(fieldsFor(k).centerStoneCarat?.label).toBe('Center weight (ct)')
      expect(fieldsFor(k).ringSize).toBeUndefined()
    }
  })

  // The rule the whole design rests on.
  it('SHOWS a field the piece does not have when the line already holds a value in it', () => {
    // A ring size on a pair of earrings is a mistake to correct, so it comes back under its plain
    // name — but it comes back. Hiding it would make something she typed vanish from the screen
    // while sitting in the database.
    expect(fieldFor('earrings', 'ringSize', false)).toBeNull()
    expect(fieldFor('earrings', 'ringSize', true)?.label).toBe('Ring size')
    expect(fieldFor('tennis_necklace', 'sideStoneCaratTotal', true)?.label).toBe('Side total weight (ct)')
  })
})

describe('the document says the same words as the form', () => {
  const line = (over: Partial<OrderLineItem> = {}): OrderLineItem => ({
    id: 'l', orderId: 'o', productName: 'Tennis necklace ', description: null, sku: null,
    quantity: 1, unitPriceCents: 0, measurements: "16''", color: null, material: null,
    customSpec: null, productRef: null, lineTotalCents: 0, displayOrder: 0, internalCostCents: null,
    productType: null, stoneQuality: null, stoneColor: null, stoneOrigin: null, stoneType: null,
    centerStoneShape: 'Round', sideStoneShape: null, centerStoneCarat: 17, sideStoneCaratTotal: null,
    metalKarat: null, certificateLab: null, ringSize: null,
    ...over,
  })

  it('prints her 17ct as a TOTAL on a tennis necklace, without the number moving', () => {
    const rows = Object.fromEntries(specRows(line()))
    expect(rows['Total weight']).toBe('17 ct')
    expect(rows['Center weight']).toBeUndefined()
    expect(rows['Length']).toBe("16''")
    expect(rows['Measurements']).toBeUndefined()
  })

  it('still prints Center weight on a ring', () => {
    const rows = Object.fromEntries(specRows(line({ productName: 'Solitaire ring', measurements: '10X7.5X4' })))
    expect(rows['Center weight']).toBe('17 ct')
    expect(rows['Measurements']).toBe('10X7.5X4')
  })

  it('prints the TYPE only when she chose it — never the one that was read off a name', () => {
    // Renaming a field is calling a number what it is. Printing "Tennis necklace" on a document
    // because we guessed it from a product name would be the document asserting something nobody said.
    expect(Object.fromEntries(specRows(line()))['Type']).toBeUndefined()
    expect(Object.fromEntries(specRows(line({ productType: 'Tennis necklace' })))['Type']).toBe('Tennis necklace')
  })
})

describe('the list keys the form reads are all declared', () => {
  it('has no key the starter template does not know about', () => {
    // JEWELRY_LIST_KEYS documented the mapping and was imported nowhere, so it could drift from the
    // form for free. This is the assertion that stops that.
    const form = readFileSync('components/orders/line-item-fields.tsx', 'utf8')
    const used = [...form.matchAll(/opts\('([a-z_]+)'\)/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(5)
    for (const k of used) expect(JEWELRY_LIST_KEYS as readonly string[]).toContain(k)
  })
})
