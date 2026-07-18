import { describe, it, expect } from 'vitest'
import { validateFieldValue, type FieldDef } from './field-validate'

const def = (o: Partial<FieldDef> & { field_type: FieldDef['field_type'] }): FieldDef => ({ key: 'f', ...o })

describe('validateFieldValue', () => {
  it('required rejects empty; optional allows null', () => {
    expect(validateFieldValue(def({ field_type: 'text', required: true }), '')).toMatchObject({ ok: false, error: 'required' })
    expect(validateFieldValue(def({ field_type: 'text' }), null)).toEqual({ ok: true, value: null })
  })
  it('money must be integer minor units', () => {
    expect(validateFieldValue(def({ field_type: 'money' }), 1999)).toEqual({ ok: true, value: 1999 })
    expect(validateFieldValue(def({ field_type: 'money' }), 19.99)).toMatchObject({ ok: false, error: 'money_must_be_integer_minor_units' })
  })
  it('integer vs decimal', () => {
    expect(validateFieldValue(def({ field_type: 'integer' }), 3.5)).toMatchObject({ ok: false })
    expect(validateFieldValue(def({ field_type: 'decimal' }), 3.5)).toEqual({ ok: true, value: 3.5 })
  })
  it('numeric min/max', () => {
    expect(validateFieldValue(def({ field_type: 'decimal', validation: { min: 0, max: 10 } }), 11)).toMatchObject({ ok: false, error: 'above_max' })
    expect(validateFieldValue(def({ field_type: 'decimal', validation: { min: 0 } }), -1)).toMatchObject({ ok: false, error: 'below_min' })
  })
  it('select enforces options', () => {
    const d = def({ field_type: 'select', options: ['velvet', 'leather'] })
    expect(validateFieldValue(d, 'velvet')).toEqual({ ok: true, value: 'velvet' })
    expect(validateFieldValue(d, 'silk')).toMatchObject({ ok: false, error: 'invalid_option' })
  })
  it('multi_select validates each option', () => {
    const d = def({ field_type: 'multi_select', options: ['a', 'b', 'c'] })
    expect(validateFieldValue(d, ['a', 'b'])).toEqual({ ok: true, value: ['a', 'b'] })
    expect(validateFieldValue(d, ['a', 'z'])).toMatchObject({ ok: false })
  })
  it('boolean coercion', () => {
    expect(validateFieldValue(def({ field_type: 'boolean' }), 'true')).toEqual({ ok: true, value: true })
    expect(validateFieldValue(def({ field_type: 'boolean' }), 'maybe')).toMatchObject({ ok: false })
  })
  it('date + datetime formats', () => {
    expect(validateFieldValue(def({ field_type: 'date' }), '2026-07-17')).toEqual({ ok: true, value: '2026-07-17' })
    expect(validateFieldValue(def({ field_type: 'date' }), '17/07/2026')).toMatchObject({ ok: false })
    expect((validateFieldValue(def({ field_type: 'datetime' }), '2026-07-17T10:00:00Z') as { value: string }).value).toContain('2026-07-17T10:00:00')
  })
  it('relation requires a uuid', () => {
    expect(validateFieldValue(def({ field_type: 'contact_relation' }), '3f2a9c17-1111-2222-3333-444455556666')).toMatchObject({ ok: true })
    expect(validateFieldValue(def({ field_type: 'contact_relation' }), 'nope')).toMatchObject({ ok: false, error: 'expected_relation_id' })
  })
  it('text maxLength', () => {
    expect(validateFieldValue(def({ field_type: 'text', validation: { maxLength: 3 } }), 'abcd')).toMatchObject({ ok: false, error: 'too_long' })
  })
})
