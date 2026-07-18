import { describe, it, expect } from 'vitest'
import { installAction, normalizeTemplate } from './package-plan'

describe('installAction', () => {
  it('is an install when never installed', () => {
    expect(installAction(null, 1)).toBe('install')
    expect(installAction(undefined, 3)).toBe('install')
  })
  it('is a reinstall at the same version (idempotent re-run)', () => {
    expect(installAction(2, 2)).toBe('reinstall')
  })
  it('is an upgrade when the catalog version is newer', () => {
    expect(installAction(1, 2)).toBe('upgrade')
  })
  it('is a reinstall when the installed version is somehow ahead (never downgrades)', () => {
    expect(installAction(5, 3)).toBe('reinstall')
  })
})

describe('normalizeTemplate', () => {
  it('parses options given as an array', () => {
    const t = normalizeTemplate({ entity_type: 'product', key: 'fabric', label: 'Fabric', field_type: 'select', options: [{ value: 'velvet', label: 'Velvet' }], sort_order: 0 })
    expect(t.options).toEqual([{ value: 'velvet', label: 'Velvet' }])
  })
  it('parses options given as a JSON string', () => {
    const t = normalizeTemplate({ entity_type: 'product', key: 'metal', label: 'Metal', field_type: 'select', options: '[{"value":"gold","label":"Gold"}]', sort_order: 1 })
    expect(t.options).toEqual([{ value: 'gold', label: 'Gold' }])
  })
  it('drops malformed options and defaults missing fields', () => {
    const t = normalizeTemplate({ entity_type: 'product', key: 'x', label: 'X', field_type: 'decimal', options: [{ value: 'ok', label: 'Ok' }, { value: 1 } as never, null as never] })
    expect(t.options).toEqual([{ value: 'ok', label: 'Ok' }])
    expect(t.required).toBe(false)
    expect(t.sort_order).toBe(0)
    expect(t.validation).toEqual({})
  })
  it('treats null options as empty', () => {
    const t = normalizeTemplate({ entity_type: 'product', key: 'width_cm', label: 'Width', field_type: 'decimal', options: null, sort_order: 2 })
    expect(t.options).toEqual([])
  })
})
