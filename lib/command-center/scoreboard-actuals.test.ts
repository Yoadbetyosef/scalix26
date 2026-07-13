import { describe, it, expect, afterEach } from 'vitest'
import { scoreEntry, assembleScoreboard, weekStartOf, type ScoreboardRow } from './scoreboard'
import { __setActualsDepsForTests, getActuals, type ActualsDeps } from './actuals'

afterEach(() => __setActualsDepsForTests(null))

describe('Weekly Scoreboard scoring (spec examples)', () => {
  it('Direct 20 goal / 17 actual → yellow', () => {
    const s = scoreEntry(20, 17)
    expect(s.status).toBe('yellow'); expect(s.variance).toBe(-3)
  })
  it('Affiliate 15 goal / 18 actual → green', () => expect(scoreEntry(15, 18).status).toBe('green'))
  it('White Label 3 goal / 1 actual → red', () => expect(scoreEntry(3, 1).status).toBe('red'))
  it('Expansion ARPU 450 goal / 431 actual → yellow', () => expect(scoreEntry(450, 431).status).toBe('yellow'))
  it('unreported actual → yellow; trend vs prior week', () => {
    expect(scoreEntry(20, null).status).toBe('yellow')
    expect(scoreEntry(20, 15, 10).trend).toBe('up')
    expect(scoreEntry(20, 10, 15).trend).toBe('down')
  })
  it('assembles a week with per-engine status + trend', () => {
    const rows: ScoreboardRow[] = [{ engine: 'direct', metricKey: 'customers', goalValue: 20, actualValue: 17, notes: null, owner: 'CEO' }]
    const prior: ScoreboardRow[] = [{ engine: 'direct', metricKey: 'customers', goalValue: 20, actualValue: 12, notes: null, owner: null }]
    const items = assembleScoreboard(rows, prior)
    expect(items[0].scored.status).toBe('yellow')
    expect(items[0].scored.trend).toBe('up')
    expect(items[0].label).toBe('New customers')
  })
  it('weekStartOf returns the Monday of the week', () => {
    const ws = weekStartOf(new Date('2026-07-15T12:00:00Z'))
    expect(new Date(ws + 'T00:00:00Z').getUTCDay()).toBe(1) // Monday
  })
})

describe('Actuals adapters (verified sources only; Manual never faked)', () => {
  const fake: ActualsDeps = {
    activeCustomersByEngine: async () => ({ direct: 4, affiliate: 3, whiteLabel: 5 }),
    platformRevenueCents: async () => 970000,
    usageEconomics: async () => ({ providerCostCents: 10000, markupRevenueCents: 2500 }),
  }
  it('derives customer counts + revenue from real sources; marks the rest Manual', async () => {
    __setActualsDepsForTests(fake)
    const a = await getActuals('2026-07-13')
    const by = (k: string) => a.find((m) => m.key === k)!
    expect(by('customers')).toMatchObject({ value: 12, source: 'derived' })
    expect(by('whiteLabelCustomers')).toMatchObject({ value: 5, source: 'derived' })
    expect(by('platformRevenueCents')).toMatchObject({ value: 970000, source: 'derived' })
    // Not derivable yet → Manual with a null value (never faked).
    expect(by('mrrCents')).toMatchObject({ value: null, source: 'manual' })
    expect(by('cashCents').source).toBe('manual')
  })
})
