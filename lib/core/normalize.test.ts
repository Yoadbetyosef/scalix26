import { describe, it, expect } from 'vitest'
import { normalizePhone, normalizeEmail, normalizeIdentity } from './normalize'

describe('normalizePhone', () => {
  it('strips formatting to a canonical form', () => {
    expect(normalizePhone('(415) 555-2671')).toBe('4155552671')
    expect(normalizePhone('+1 415-555-2671')).toBe('+14155552671')
  })
  it('treats 00 as +', () => expect(normalizePhone('001 415 555 2671')).toBe('+14155552671'))
  it('rejects too-short / empty', () => { expect(normalizePhone('123')).toBeNull(); expect(normalizePhone('')).toBeNull(); expect(normalizePhone(null)).toBeNull() })
  it('is stable across equivalent formats', () => expect(normalizePhone('415.555.2671')).toBe(normalizePhone('4155552671')))
})

describe('normalizeEmail', () => {
  it('lowercases + trims valid emails', () => expect(normalizeEmail('  Ari@Example.COM ')).toBe('ari@example.com'))
  it('rejects invalid', () => { expect(normalizeEmail('nope')).toBeNull(); expect(normalizeEmail('a@b')).toBeNull(); expect(normalizeEmail(null)).toBeNull() })
})

describe('normalizeIdentity', () => {
  it('routes by channel', () => {
    expect(normalizeIdentity('email', 'A@B.com')).toBe('a@b.com')
    expect(normalizeIdentity('sms', '(415) 555-2671')).toBe('4155552671')
    expect(normalizeIdentity('whatsapp', '+1 415 555 2671')).toBe('+14155552671')
    expect(normalizeIdentity('instagram', ' 178452 ')).toBe('178452') // opaque id, trimmed
  })
})
