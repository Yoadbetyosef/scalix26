import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { assertPartnerActive, __setGateDepsForTests, type GateRow, type GateDeps } from './gate'

// The gate is inert unless WL_BILLING_ENABLED === 'true'; turn it on for the decision-matrix tests and
// restore afterwards. `deps` are injected so no DB is ever touched.
beforeEach(() => { vi.stubEnv('WL_BILLING_ENABLED', 'true') })
afterEach(() => { __setGateDepsForTests(null); vi.unstubAllEnvs() })

function row(over: Partial<GateRow> = {}): GateRow {
  return { status: 'active', balance_cents: 10000, pending_charge_cents: 0, platform_fee_status: 'active', ...over }
}

function deps(over: Partial<GateDeps> = {}) {
  const d: GateDeps = {
    resolvePartner: vi.fn(async () => 'p1'),
    loadGateRow: vi.fn(async () => row()),
    ...over,
  }
  __setGateDepsForTests(d)
  return d
}

describe('assertPartnerActive — kill switch', () => {
  it('passes without touching deps when WL_BILLING_ENABLED is off', async () => {
    vi.stubEnv('WL_BILLING_ENABLED', 'false')
    const d = deps()
    expect((await assertPartnerActive({ tenantId: 't1' })).ok).toBe(true)
    expect(d.resolvePartner).not.toHaveBeenCalled()
  })
})

describe('assertPartnerActive — non-WL and un-onboarded pass', () => {
  it('passes for a direct Scalix tenant (no owning partner)', async () => {
    deps({ resolvePartner: vi.fn(async () => null) })
    const r = await assertPartnerActive({ tenantId: 't1' })
    expect(r.ok).toBe(true)
    expect(r.partnerId).toBeUndefined()
  })
  it('passes (fail-open) for a partner with no wallet row yet', async () => {
    deps({ loadGateRow: vi.fn(async () => null) })
    const r = await assertPartnerActive({ partnerId: 'p1' })
    expect(r.ok).toBe(true)
    expect(r.partnerId).toBe('p1')
  })
})

describe('assertPartnerActive — block signals', () => {
  it('blocks when status is paused', async () => {
    deps({ loadGateRow: vi.fn(async () => row({ status: 'paused' })) })
    expect(await assertPartnerActive({ partnerId: 'p1' })).toMatchObject({ ok: false, reason: 'paused_balance' })
  })
  it('blocks when available balance is depleted (<= 0)', async () => {
    deps({ loadGateRow: vi.fn(async () => row({ balance_cents: 500, pending_charge_cents: 500 })) })
    expect(await assertPartnerActive({ partnerId: 'p1' })).toMatchObject({ ok: false, reason: 'depleted' })
  })
  it('does NOT block on platform past_due (Phase 7 grace window — service continues)', async () => {
    deps({ loadGateRow: vi.fn(async () => row({ platform_fee_status: 'past_due' })) })
    expect((await assertPartnerActive({ partnerId: 'p1' })).ok).toBe(true)
  })
  it('blocks when the platform subscription is payment_required (grace expired)', async () => {
    deps({ loadGateRow: vi.fn(async () => row({ platform_fee_status: 'payment_required' })) })
    expect(await assertPartnerActive({ partnerId: 'p1' })).toMatchObject({ ok: false, reason: 'platform_unpaid' })
  })
  it('platform lapse takes precedence over a healthy balance', async () => {
    deps({ loadGateRow: vi.fn(async () => row({ platform_fee_status: 'canceled', balance_cents: 999999 })) })
    expect((await assertPartnerActive({ partnerId: 'p1' })).reason).toBe('platform_unpaid')
  })
})

describe('assertPartnerActive — healthy + fail-open', () => {
  it('passes a funded, active partner', async () => {
    deps()
    expect(await assertPartnerActive({ tenantId: 't1' })).toMatchObject({ ok: true, partnerId: 'p1' })
  })
  it('resolves tenant → partner only when partnerId not supplied', async () => {
    const d = deps()
    await assertPartnerActive({ partnerId: 'p1' })
    expect(d.resolvePartner).not.toHaveBeenCalled()
  })
  it('fails OPEN when a deps lookup throws', async () => {
    deps({ loadGateRow: vi.fn(async () => { throw new Error('db down') }) })
    expect((await assertPartnerActive({ partnerId: 'p1' })).ok).toBe(true)
  })
})
