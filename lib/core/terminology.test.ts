import { describe, it, expect } from 'vitest'
import { resolveTerm, isSupportedTerm } from './terminology'

describe('isSupportedTerm (whitelist — system actions never renameable)', () => {
  it('accepts supported business nouns', () => { expect(isSupportedTerm('order')).toBe(true); expect(isSupportedTerm('invoice')).toBe(true) })
  it('rejects system actions / unknown', () => { expect(isSupportedTerm('save')).toBe(false); expect(isSupportedTerm('delete')).toBe(false); expect(isSupportedTerm('settings')).toBe(false); expect(isSupportedTerm('anything')).toBe(false) })
})

describe('resolveTerm', () => {
  it('uses the Core default when no override', () => { expect(resolveTerm('order', {})).toBe('Order'); expect(resolveTerm('order', {}, { plural: true })).toBe('Orders') })
  it('override wins (singular + plural)', () => {
    const ov = { order: { singular: 'Memo', plural: 'Memos' } }
    expect(resolveTerm('order', ov)).toBe('Memo'); expect(resolveTerm('order', ov, { plural: true })).toBe('Memos')
  })
  it('falls back to default plural when only singular overridden', () => {
    expect(resolveTerm('order', { order: { singular: 'Memo' } }, { plural: true })).toBe('Orders')
  })
  it('blank override is ignored (falls back to default)', () => expect(resolveTerm('order', { order: { singular: '  ' } })).toBe('Order'))
})
