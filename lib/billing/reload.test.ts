import { describe, it, expect, afterEach, vi } from 'vitest'
import { attemptAutoReload, ensureFunded, __setReloadDepsForTests, type WalletRow, type ReloadDeps } from './reload'

afterEach(() => __setReloadDepsForTests(null))

function wallet(over: Partial<WalletRow> = {}): WalletRow {
  return {
    partner_id: 'p1', balance_cents: 10000, pending_charge_cents: 0, currency: 'usd', status: 'active',
    auto_reload_enabled: false, auto_reload_threshold_cents: 5000, auto_reload_amount_cents: 50000,
    auto_reload_pending: false, last_auto_reload_at: null, stripe_customer_id: null, stripe_payment_method_id: null,
    ...over,
  }
}

// Build a deps spy set around a fixed wallet + a scripted charge outcome.
function deps(w: WalletRow, charge: { ok: boolean; paymentIntentId?: string } = { ok: true, paymentIntentId: 'pi_1' }) {
  const calls = { charge: 0, credit: 0, pending: [] as boolean[], reloaded: 0, status: [] as string[] }
  const d: ReloadDeps = {
    loadWallet: vi.fn(async () => w),
    chargeOffSession: vi.fn(async () => { calls.charge++; return charge }),
    credit: vi.fn(async () => { calls.credit++ }),
    setReloadPending: vi.fn(async (_p, v) => { calls.pending.push(v) }),
    markReloaded: vi.fn(async () => { calls.reloaded++ }),
    setStatus: vi.fn(async (_p, s) => { calls.status.push(s) }),
  }
  __setReloadDepsForTests(d)
  return { d, calls }
}

describe('attemptAutoReload guards', () => {
  it('fails when auto-reload is disabled', async () => {
    deps(wallet({ auto_reload_enabled: false }))
    expect((await attemptAutoReload('p1')).reason).toBe('disabled')
  })
  it('fails with no_payment_method when no card is saved', async () => {
    deps(wallet({ auto_reload_enabled: true }))
    expect((await attemptAutoReload('p1')).reason).toBe('no_payment_method')
  })
  it('fails already_pending (prevents concurrent double charge)', async () => {
    deps(wallet({ auto_reload_enabled: true, auto_reload_pending: true, stripe_customer_id: 'c', stripe_payment_method_id: 'pm' }))
    expect((await attemptAutoReload('p1')).reason).toBe('already_pending')
  })
  it('succeeds, credits the amount, and stamps reloaded', async () => {
    const { calls } = deps(wallet({ auto_reload_enabled: true, stripe_customer_id: 'c', stripe_payment_method_id: 'pm' }))
    const r = await attemptAutoReload('p1')
    expect(r.ok).toBe(true)
    expect(r.creditedCents).toBe(50000)
    expect(calls.charge).toBe(1)
    expect(calls.credit).toBe(1)
    expect(calls.reloaded).toBe(1)
  })
  it('clears the pending flag when the charge fails', async () => {
    const { calls } = deps(wallet({ auto_reload_enabled: true, stripe_customer_id: 'c', stripe_payment_method_id: 'pm' }), { ok: false })
    const r = await attemptAutoReload('p1')
    expect(r.ok).toBe(false)
    expect(calls.pending).toEqual([true, false]) // set then cleared
    expect(calls.credit).toBe(0)
  })
})

describe('ensureFunded — reload BEFORE pause, never negative', () => {
  it('healthy balance → ok, no charge', async () => {
    const { calls } = deps(wallet({ balance_cents: 10000, auto_reload_enabled: true, auto_reload_threshold_cents: 5000, stripe_customer_id: 'c', stripe_payment_method_id: 'pm' }))
    const r = await ensureFunded('p1')
    expect(r.decision).toBe('ok')
    expect(calls.charge).toBe(0)
  })

  it('low balance + reload succeeds → reloaded, continues (not paused)', async () => {
    const { calls } = deps(wallet({ balance_cents: 2000, auto_reload_enabled: true, auto_reload_threshold_cents: 5000, stripe_customer_id: 'c', stripe_payment_method_id: 'pm' }))
    const r = await ensureFunded('p1')
    expect(r.decision).toBe('reloaded')
    expect(calls.charge).toBe(1)
    expect(calls.status).not.toContain('paused')
  })

  it('depleted + reload FAILS (no card) → pauses', async () => {
    const { calls } = deps(wallet({ balance_cents: 0, auto_reload_enabled: true, auto_reload_threshold_cents: 5000 }))
    const r = await ensureFunded('p1')
    expect(r.decision).toBe('paused')
    expect(calls.status).toContain('paused')
  })

  it('depleted + auto-reload disabled → pauses (no charge attempted)', async () => {
    const { calls } = deps(wallet({ balance_cents: 0, auto_reload_enabled: false }))
    const r = await ensureFunded('p1')
    expect(r.decision).toBe('paused')
    expect(calls.charge).toBe(0)
  })

  it('low-but-positive + reload disabled → keeps serving (not paused)', async () => {
    const { calls } = deps(wallet({ balance_cents: 3000, auto_reload_enabled: false }))
    const r = await ensureFunded('p1')
    expect(r.decision).toBe('ok')
    expect(calls.status).not.toContain('paused')
  })

  it('available accounts for pending exposure (balance − pending)', async () => {
    const { calls } = deps(wallet({ balance_cents: 6000, pending_charge_cents: 6000, auto_reload_enabled: false }))
    const r = await ensureFunded('p1') // available = 0 → paused
    expect(r.availableCents).toBe(0)
    expect(r.decision).toBe('paused')
    expect(calls.credit).toBe(0) // never drives balance negative — only pauses
  })
})
