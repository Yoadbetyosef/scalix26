import { describe, it, expect } from 'vitest'
import { derivePaymentStatus } from './payments'
import { available } from './inventory'

describe('derivePaymentStatus', () => {
  it('unpaid at 0', () => expect(derivePaymentStatus(10000, 0)).toBe('unpaid'))
  it('partial below total', () => expect(derivePaymentStatus(10000, 3000)).toBe('partial'))
  it('paid at/over total', () => { expect(derivePaymentStatus(10000, 10000)).toBe('paid'); expect(derivePaymentStatus(10000, 12000)).toBe('paid') })
  it('refunded when net negative', () => expect(derivePaymentStatus(10000, -500)).toBe('refunded'))
})

describe('available (on_hand − reserved)', () => {
  it('subtracts reserved', () => expect(available(10, 3)).toBe(7))
  it('can be zero', () => expect(available(5, 5)).toBe(0))
})
