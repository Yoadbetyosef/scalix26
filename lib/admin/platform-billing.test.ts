import { describe, it, expect } from 'vitest'
import { computeProfitability, type PartnerFinancials } from './platform-billing'

const base: PartnerFinancials = {
  partnerId: 'p1', name: 'Acme', activeClients: 3, billedQuantity: 3, platformStatus: 'active',
  walletBalanceCents: 50000, walletReloadsCents: 200000,
  usageRevenueCents: 12500, providerCostCents: 10000, platformRevenueCents: 29100,
}

describe('computeProfitability — the P&L identity', () => {
  it('gross profit = platform revenue + usage revenue − provider cost', () => {
    const r = computeProfitability(base)
    expect(r.grossProfitCents).toBe(29100 + 12500 - 10000) // 31600
    expect(r.markupRevenueCents).toBe(12500 - 10000)       // 2500
    expect(r.netProviderSpendCents).toBe(10000)
    expect(r.mrrCents).toBe(3 * 9700)                      // 29100
  })

  it('is reproducible: same inputs → same outputs', () => {
    expect(computeProfitability(base)).toEqual(computeProfitability({ ...base }))
  })

  it('outstanding reflects an unpaid platform cycle only when past_due/payment_required', () => {
    expect(computeProfitability({ ...base, platformStatus: 'active' }).outstandingCents).toBe(0)
    expect(computeProfitability({ ...base, platformStatus: 'past_due' }).outstandingCents).toBe(29100)
    expect(computeProfitability({ ...base, platformStatus: 'payment_required' }).outstandingCents).toBe(29100)
  })

  it('handles a partner with zero usage and zero platform revenue', () => {
    const r = computeProfitability({ ...base, activeClients: 0, usageRevenueCents: 0, providerCostCents: 0, platformRevenueCents: 0 })
    expect(r.grossProfitCents).toBe(0)
    expect(r.mrrCents).toBe(0)
  })
})
