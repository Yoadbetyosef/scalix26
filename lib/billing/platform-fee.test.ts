import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  syncPlatformQuantity, onPlatformInvoicePaid, onPlatformInvoiceFailed,
  expirePlatformGraceIfDue, onPlatformSubscriptionCanceled, cancelPlatformSubscription, platformAdminSyncAllowed,
  __setPlatformDepsForTests, type PlatformDeps, type PlatformState, type PlatformEvent,
} from './platform-fee'

beforeEach(() => { vi.stubEnv('WL_PLATFORM_FEE_ENABLED', 'true'); vi.stubEnv('WL_PLATFORM_GRACE_DAYS', '7') })
afterEach(() => { __setPlatformDepsForTests(null); vi.unstubAllEnvs() })

describe('platformAdminSyncAllowed — Preview-gated manual sync capability', () => {
  it('is off when the platform fee is disabled, even on Preview', () => {
    vi.stubEnv('WL_PLATFORM_FEE_ENABLED', 'false'); vi.stubEnv('VERCEL_ENV', 'preview')
    expect(platformAdminSyncAllowed()).toBe(false)
  })
  it('is ON when enabled AND deployment is Preview', () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(platformAdminSyncAllowed()).toBe(true)
  })
  it('is OFF on production unless the explicit prod flag is set', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(platformAdminSyncAllowed()).toBe(false)
    vi.stubEnv('WL_PLATFORM_ADMIN_SYNC_PROD', 'true')
    expect(platformAdminSyncAllowed()).toBe(true)
  })
})

function fake(initial: Partial<PlatformState> = {}, activeCount = 0, hasPM = true) {
  const state: PlatformState = {
    partnerId: 'p1', subscriptionId: null, itemId: null, activeQty: 0, status: 'none',
    graceUntil: null, currentPeriodEnd: null, customerId: 'cus_1', ...initial,
  }
  let active = activeCount
  let pm = hasPM
  let notifyCount = 0
  const events: PlatformEvent[] = []
  const seen = new Set<string>()
  const stripe = { created: 0, updates: [] as number[], canceled: 0 }
  const d: PlatformDeps = {
    countActive: async () => active,
    loadState: async () => ({ ...state }),
    ensureCustomer: async () => 'cus_1',
    createSubscription: async ({ quantity }) => { stripe.created++; return { subscriptionId: 'sub_1', itemId: 'si_1', currentPeriodEnd: '2026-08-01T00:00:00Z', status: 'active' } },
    updateQuantity: async ({ quantity }) => { stripe.updates.push(quantity) },
    cancelSubscription: async () => { stripe.canceled++ },
    saveState: async (_p, patch) => { Object.assign(state, patch) },
    recordEvent: async (e) => { if (seen.has(e.idempotencyKey)) return false; seen.add(e.idempotencyKey); events.push(e); return true },
    hasPaymentMethod: async () => pm,
    notifyPaymentMethodRequired: async () => { notifyCount++ },
  }
  __setPlatformDepsForTests(d)
  const setActive = (n: number) => { active = n }
  const setPM = (v: boolean) => { pm = v }
  const typeCount = (t: string) => events.filter((e) => e.eventType === t).length
  return { state, events, stripe, setActive, setPM, typeCount, notifyCount: () => notifyCount }
}

describe('safety: inert unless enabled', () => {
  it('syncPlatformQuantity is a no-op when the flag is off', async () => {
    vi.stubEnv('WL_PLATFORM_FEE_ENABLED', 'false')
    const f = fake({}, 3)
    expect(await syncPlatformQuantity('p1')).toEqual({ action: 'skipped', quantity: 0 })
    expect(f.stripe.created).toBe(0)
    expect(f.events.length).toBe(0)
  })
})

describe('one subscription, dynamic quantity', () => {
  it('does not create a subscription while there are zero active clients', async () => {
    const f = fake({}, 0)
    expect((await syncPlatformQuantity('p1')).action).toBe('no_subscription')
    expect(f.stripe.created).toBe(0)
  })

  it('NEW client → creates the ONE subscription, then quantity increases', async () => {
    const f = fake({}, 1)
    expect(await syncPlatformQuantity('p1')).toEqual({ action: 'created', quantity: 1 })
    expect(f.stripe.created).toBe(1)
    expect(f.state.subscriptionId).toBe('sub_1')
    expect(f.state.activeQty).toBe(1)

    f.setActive(2)
    expect(await syncPlatformQuantity('p1')).toEqual({ action: 'increased', quantity: 2 })
    expect(f.stripe.created).toBe(1)              // never a second subscription
    expect(f.stripe.updates).toEqual([2])
    expect(f.typeCount('quantity_changed')).toBe(1)
  })

  it('DELETED/suspended client → quantity decreases', async () => {
    const f = fake({ subscriptionId: 'sub_1', itemId: 'si_1', status: 'active', activeQty: 3 }, 3)
    f.setActive(2)
    expect(await syncPlatformQuantity('p1')).toEqual({ action: 'decreased', quantity: 2 })
    expect(f.stripe.updates).toEqual([2])
  })

  it('NO payment method → never throws, no subscription, records ONE event, notifies ONCE (idempotent)', async () => {
    const f = fake({}, 2, /* hasPM */ false)
    // First run: transition into payment_method_required, one event, one notice.
    expect(await syncPlatformQuantity('p1')).toEqual({ action: 'no_payment_method', quantity: 2 })
    expect(f.stripe.created).toBe(0)                 // never touched Stripe
    expect(f.state.status).toBe('payment_method_required')
    expect(f.typeCount('no_payment_method')).toBe(1)
    expect(f.notifyCount()).toBe(1)
    // Repeat cron runs: no new subscription, no duplicate event, no notification spam.
    expect((await syncPlatformQuantity('p1')).action).toBe('no_payment_method')
    expect((await syncPlatformQuantity('p1')).action).toBe('no_payment_method')
    expect(f.typeCount('no_payment_method')).toBe(1)
    expect(f.notifyCount()).toBe(1)
    expect(f.stripe.created).toBe(0)
  })

  it('payment method added later → subscription is created (recovers from payment_method_required)', async () => {
    const f = fake({}, 1, false)
    expect((await syncPlatformQuantity('p1')).action).toBe('no_payment_method')
    f.setPM(true)
    expect((await syncPlatformQuantity('p1')).action).toBe('created')
    expect(f.stripe.created).toBe(1)
    expect(f.state.status).toBe('active')
  })

  it('active clients drop to zero while payment_method_required → status cleared, no throw', async () => {
    const f = fake({ status: 'payment_method_required', activeQty: 1 }, 0, false)
    expect((await syncPlatformQuantity('p1')).action).toBe('no_subscription')
    expect(f.state.status).toBe('none')
  })

  it('DUPLICATE sync (same active count) → no duplicate quantity update or event', async () => {
    const f = fake({ subscriptionId: 'sub_1', itemId: 'si_1', status: 'active', activeQty: 2 }, 2)
    expect((await syncPlatformQuantity('p1')).action).toBe('unchanged')
    expect((await syncPlatformQuantity('p1')).action).toBe('unchanged')
    expect(f.stripe.updates).toEqual([])
    expect(f.typeCount('quantity_changed')).toBe(0)
  })
})

describe('dunning: grace then gating', () => {
  it('FAILED payment → past_due + grace window starts (not gated yet)', async () => {
    const f = fake({ subscriptionId: 'sub_1', status: 'active', activeQty: 1 }, 1)
    const r = await onPlatformInvoiceFailed('p1', { invoiceId: 'in_1', amountCents: 9700 }, Date.parse('2026-07-12T00:00:00Z'))
    expect(r.applied).toBe(true)
    expect(f.state.status).toBe('past_due')
    expect(f.state.graceUntil).toBe('2026-07-19T00:00:00.000Z') // +7 days
    expect(f.typeCount('invoice_failed')).toBe(1)
    expect(f.typeCount('grace_started')).toBe(1)
  })

  it('DUPLICATE failed webhook → no second transition or event', async () => {
    const f = fake({ subscriptionId: 'sub_1', status: 'active', activeQty: 1 }, 1)
    await onPlatformInvoiceFailed('p1', { invoiceId: 'in_1' }, Date.parse('2026-07-12T00:00:00Z'))
    const dup = await onPlatformInvoiceFailed('p1', { invoiceId: 'in_1' }, Date.parse('2026-07-12T00:00:00Z'))
    expect(dup.applied).toBe(false)
    expect(f.typeCount('invoice_failed')).toBe(1)
  })

  it('GRACE expires → payment_required (idempotent)', async () => {
    const f = fake({ subscriptionId: 'sub_1', status: 'past_due', graceUntil: '2026-07-19T00:00:00.000Z', activeQty: 1 }, 1)
    const now = Date.parse('2026-07-20T00:00:00Z')
    expect((await expirePlatformGraceIfDue('p1', now)).transitioned).toBe(true)
    expect(f.state.status).toBe('payment_required')
    expect(f.typeCount('payment_required')).toBe(1)
    // second sweep: already transitioned → no-op
    expect((await expirePlatformGraceIfDue('p1', now)).transitioned).toBe(false)
    expect(f.typeCount('payment_required')).toBe(1)
  })

  it('GRACE not yet expired → stays past_due', async () => {
    const f = fake({ subscriptionId: 'sub_1', status: 'past_due', graceUntil: '2026-07-19T00:00:00.000Z' }, 1)
    expect((await expirePlatformGraceIfDue('p1', Date.parse('2026-07-15T00:00:00Z'))).transitioned).toBe(false)
    expect(f.state.status).toBe('past_due')
  })

  it('SUCCESSFUL payment after failure → restored to active, grace cleared', async () => {
    const f = fake({ subscriptionId: 'sub_1', status: 'payment_required', graceUntil: '2026-07-19T00:00:00.000Z', activeQty: 1 }, 1)
    const r = await onPlatformInvoicePaid('p1', { invoiceId: 'in_2', amountCents: 9700, periodEnd: '2026-08-19T00:00:00Z' })
    expect(r.applied).toBe(true)
    expect(f.state.status).toBe('active')
    expect(f.state.graceUntil).toBeNull()
    expect(f.state.currentPeriodEnd).toBe('2026-08-19T00:00:00Z')
    expect(f.typeCount('invoice_paid')).toBe(1)
    expect(f.typeCount('restored')).toBe(1)
  })

  it('DUPLICATE paid webhook → no double credit/transition', async () => {
    const f = fake({ subscriptionId: 'sub_1', status: 'active', activeQty: 1 }, 1)
    await onPlatformInvoicePaid('p1', { invoiceId: 'in_3', amountCents: 9700 })
    const dup = await onPlatformInvoicePaid('p1', { invoiceId: 'in_3', amountCents: 9700 })
    expect(dup.applied).toBe(false)
    expect(f.typeCount('invoice_paid')).toBe(1)
  })
})

describe('separation + reproducible history', () => {
  it('platform ops record ONLY to the platform event log (wallet/usage untouched by construction)', async () => {
    // The fake deps expose no wallet mutator; the module imports none. Every mutation here is a platform
    // event or platform_balances state field — never balance_cents or the usage ledger.
    const f = fake({ subscriptionId: 'sub_1', status: 'active', activeQty: 1 }, 2)
    await syncPlatformQuantity('p1')
    await onPlatformInvoiceFailed('p1', { invoiceId: 'in_9' }, Date.parse('2026-07-12T00:00:00Z'))
    expect(f.events.every((e) => e.partnerId === 'p1')).toBe(true)
    expect(f.events.map((e) => e.eventType)).toContain('quantity_changed')
  })

  it('history is append-only and duplicate-safe → platform revenue is reproducible', async () => {
    const f = fake({ subscriptionId: 'sub_1', status: 'active', activeQty: 1 }, 1)
    await onPlatformInvoicePaid('p1', { invoiceId: 'inv_a', amountCents: 9700 })
    await onPlatformInvoicePaid('p1', { invoiceId: 'inv_a', amountCents: 9700 }) // replay
    await onPlatformInvoicePaid('p1', { invoiceId: 'inv_b', amountCents: 19400 })
    const revenue = f.events.filter((e) => e.eventType === 'invoice_paid').reduce((s, e) => s + (e.amountCents || 0), 0)
    expect(revenue).toBe(29100) // 9700 + 19400 — the replay did not double-count
  })

  it('subscription canceled → terminal canceled state, idempotent', async () => {
    const f = fake({ subscriptionId: 'sub_1', status: 'active' }, 0)
    expect((await onPlatformSubscriptionCanceled('p1', { subscriptionId: 'sub_1' })).applied).toBe(true)
    expect(f.state.status).toBe('canceled')
    expect((await onPlatformSubscriptionCanceled('p1', { subscriptionId: 'sub_1' })).applied).toBe(false)
  })

  it('cancelPlatformSubscription → cancels in Stripe once + records terminal canceled state', async () => {
    const f = fake({ subscriptionId: 'sub_1', status: 'active', activeQty: 2 }, 2)
    const r = await cancelPlatformSubscription('p1')
    expect(r).toEqual({ canceled: true, subscriptionId: 'sub_1' })
    expect(f.stripe.canceled).toBe(1)
    expect(f.state.status).toBe('canceled')
    expect(f.typeCount('canceled')).toBe(1)
  })

  it('cancelPlatformSubscription → no-op when the partner has no subscription', async () => {
    const f = fake({ subscriptionId: null }, 0)
    expect(await cancelPlatformSubscription('p1')).toEqual({ canceled: false, subscriptionId: null })
    expect(f.stripe.canceled).toBe(0)
  })
})
