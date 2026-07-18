import { describe, it, expect } from 'vitest'
import { initialFieldState, coerceFieldValue, type FieldDef } from './field-ui'
import type { FieldType } from './field-validate'

const def = (t: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({ id: 'd', key: 'k', label: 'Field', field_type: t, required: false, ...extra })

describe('initialFieldState', () => {
  it('formats money cents as a dollar input string', () => { expect(initialFieldState(def('money'), 129900)).toBe('1299.00') })
  it('keeps multi_select as an array and booleans as booleans', () => {
    expect(initialFieldState(def('multi_select'), ['a', 'b'])).toEqual(['a', 'b'])
    expect(initialFieldState(def('boolean'), true)).toBe(true)
    expect(initialFieldState(def('boolean'), null)).toBe(false)
  })
  it('stringifies scalar values and blanks null', () => {
    expect(initialFieldState(def('integer'), 5)).toBe('5')
    expect(initialFieldState(def('text'), null)).toBe('')
  })
})

describe('coerceFieldValue', () => {
  it('money → integer cents (server stays authoritative)', () => {
    expect(coerceFieldValue(def('money'), '19.99')).toEqual({ ok: true, value: 1999 })
    expect(coerceFieldValue(def('money'), 'abc').ok).toBe(false)
  })
  it('integer rejects fractionals, accepts whole, blanks to null', () => {
    expect(coerceFieldValue(def('integer'), '3')).toEqual({ ok: true, value: 3 })
    expect(coerceFieldValue(def('integer'), '3.5').ok).toBe(false)
    expect(coerceFieldValue(def('integer'), '')).toEqual({ ok: true, value: null })
  })
  it('decimal parses numbers and rejects junk', () => {
    expect(coerceFieldValue(def('decimal'), '2.5')).toEqual({ ok: true, value: 2.5 })
    expect(coerceFieldValue(def('decimal'), 'x').ok).toBe(false)
  })
  it('boolean/multi_select/text pass through with trimming', () => {
    expect(coerceFieldValue(def('boolean'), true)).toEqual({ ok: true, value: true })
    expect(coerceFieldValue(def('multi_select'), ['velvet'])).toEqual({ ok: true, value: ['velvet'] })
    expect(coerceFieldValue(def('text'), '  hi ')).toEqual({ ok: true, value: 'hi' })
    expect(coerceFieldValue(def('select'), '')).toEqual({ ok: true, value: null })
  })
})
