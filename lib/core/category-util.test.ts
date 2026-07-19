import { describe, it, expect } from 'vitest'
import { filterCategories, groupCategories, normalizeCategoryName } from './category-util'

const cats = [
  { id: '1', name: 'Sofas & Sectionals', group_label: 'Living Room', sort_order: 0 },
  { id: '2', name: 'Rugs', group_label: 'Decor', sort_order: 5 },
  { id: '3', name: 'Custom Thing', group_label: null, sort_order: 9 },
  { id: '4', name: 'Coffee Tables', group_label: 'Living Room', sort_order: 1 },
]

describe('filterCategories', () => {
  it('returns all for an empty query', () => { expect(filterCategories(cats, '').length).toBe(4) })
  it('matches on name', () => { expect(filterCategories(cats, 'sofa').map((c) => c.name)).toEqual(['Sofas & Sectionals']) })
  it('matches on group label', () => { expect(filterCategories(cats, 'living').map((c) => c.name).sort()).toEqual(['Coffee Tables', 'Sofas & Sectionals']) })
})

describe('groupCategories', () => {
  it('groups, orders within group by sort_order, puts ungrouped last', () => {
    const g = groupCategories(cats)
    expect(g.map((x) => x.group)).toEqual(['Living Room', 'Decor', null])
    expect(g[0].items.map((c) => c.name)).toEqual(['Sofas & Sectionals', 'Coffee Tables'])
    expect(g[2].items.map((c) => c.name)).toEqual(['Custom Thing'])
  })
})

describe('normalizeCategoryName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeCategoryName('  Sofas   &  Sectionals  ')).toBe('Sofas & Sectionals')
    expect(normalizeCategoryName('   ')).toBe('')
  })
})
