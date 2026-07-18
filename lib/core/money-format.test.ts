import { describe, it, expect } from 'vitest'
import { formatCents, centsToInput, inputToCents } from './money-format'

describe('formatCents', () => {
  it('formats integer cents as currency', () => {
    expect(formatCents(129900)).toBe('$1,299.00')
    expect(formatCents(0)).toBe('$0.00')
  })
  it('renders a dash for null', () => { expect(formatCents(null)).toBe('—') })
})

describe('centsToInput', () => {
  it('renders cents as a decimal string', () => {
    expect(centsToInput(129900)).toBe('1299.00')
    expect(centsToInput(null)).toBe('')
  })
})

describe('inputToCents', () => {
  it('parses dollars into integer cents', () => {
    expect(inputToCents('1299.99')).toBe(129999)
    expect(inputToCents('  10 ')).toBe(1000)
  })
  it('returns null for empty and NaN for invalid/negative', () => {
    expect(inputToCents('')).toBeNull()
    expect(Number.isNaN(inputToCents('abc'))).toBe(true)
    expect(Number.isNaN(inputToCents('-5'))).toBe(true)
  })
  it('always yields an integer number of cents', () => {
    expect(Number.isInteger(inputToCents('19.99'))).toBe(true)
  })
})
