// Auto-reload-before-pause orchestration. The billing flow must, when funds run low, ATTEMPT a
// Stripe auto-reload BEFORE pausing a partner — and never allow a negative balance.
//
// Order (per usage arrival / pre-flight):
//   1. compute available = balance − pending exposure
//   2. if available is above the reload threshold → OK, continue
//   3. else if auto-reload is enabled → charge the saved card off-session
//        success → credit the balance, continue
//        failure → pause (only when funds are actually depleted)
//   4. the hard floor (never-negative) is always enforced by apply_balance_txn's debit rejection.
//
// The Stripe charge + DB access are behind an injectable `deps` seam so the decision matrix is fully
// unit-testable with no Stripe and no database. Until Phase 3 saves a payment method, attemptAutoReload
// returns { ok:false, reason:'no_payment_method' } → the flow correctly falls through to pause.

export interface WalletRow {
  partner_id: string
  balance_cents: number
  pending_charge_cents: number
  currency: string
  status: 'active' | 'paused' | 'payment_required'
  auto_reload_enabled: boolean
  auto_reload_threshold_cents: number | null
  auto_reload_amount_cents: number | null
  auto_reload_pending: boolean
  last_auto_reload_at: string | null
  stripe_customer_id: string | null
  stripe_payment_method_id: string | null
}

export interface ChargeResult { ok: boolean; paymentIntentId?: string; error?: string }

export interface ReloadDeps {
  loadWallet(partnerId: string): Promise<WalletRow | null>
  chargeOffSession(a: {
    customerId: string; paymentMethodId: string; amountCents: number; currency: string; idempotencyKey: string
  }): Promise<ChargeResult>
  credit(partnerId: string, amountCents: number, opts: { idempotencyKey: string; stripeRef?: string }): Promise<void>
  setReloadPending(partnerId: string, pending: boolean): Promise<void>
  markReloaded(partnerId: string): Promise<void>   // stamp last_auto_reload_at, clear pending, status active
  setStatus(partnerId: string, status: 'active' | 'paused' | 'payment_required'): Promise<void>
}

// Real deps: lazy-imported so unit tests never load next/headers or the Stripe SDK.
const dbDeps: ReloadDeps = {
  async loadWallet(partnerId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('partner_balances').select(
      'partner_id, balance_cents, pending_charge_cents, currency, status, auto_reload_enabled, auto_reload_threshold_cents, auto_reload_amount_cents, auto_reload_pending, last_auto_reload_at, stripe_customer_id, stripe_payment_method_id',
    ).eq('partner_id', partnerId).maybeSingle()
    return (data as WalletRow) || null
  },
  async chargeOffSession(a) {
    const { stripe } = await import('@/lib/stripe/client')
    try {
      const pi = await stripe.paymentIntents.create({
        amount: a.amountCents, currency: a.currency, customer: a.customerId, payment_method: a.paymentMethodId,
        off_session: true, confirm: true, metadata: { kind: 'auto_reload' },
      }, { idempotencyKey: a.idempotencyKey })
      return pi.status === 'succeeded' ? { ok: true, paymentIntentId: pi.id } : { ok: false, error: pi.status }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'charge_failed' }
    }
  },
  async credit(partnerId, amountCents, opts) {
    const { creditBalance } = await import('./balance')
    await creditBalance(partnerId, amountCents, { type: 'auto_reload', idempotencyKey: opts.idempotencyKey, stripeRef: opts.stripeRef ?? null })
  },
  async setReloadPending(partnerId, pending) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('partner_balances').update({ auto_reload_pending: pending }).eq('partner_id', partnerId)
  },
  async markReloaded(partnerId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('partner_balances')
      .update({ auto_reload_pending: false, last_auto_reload_at: new Date().toISOString(), status: 'active' })
      .eq('partner_id', partnerId)
  },
  async setStatus(partnerId, status) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('partner_balances').update({ status }).eq('partner_id', partnerId)
  },
}

let deps: ReloadDeps = dbDeps
export function __setReloadDepsForTests(d: ReloadDeps | null) { deps = d ?? dbDeps }

export type ReloadReason =
  | 'disabled' | 'no_payment_method' | 'no_amount' | 'already_pending' | 'no_wallet' | 'charge_failed'

export interface ReloadResult { ok: boolean; reason?: ReloadReason; creditedCents?: number }

// Attempt a single off-session auto-reload. Idempotency + the pending flag prevent double charges.
export async function attemptAutoReload(partnerId: string, w?: WalletRow): Promise<ReloadResult> {
  const wallet = w ?? (await deps.loadWallet(partnerId))
  if (!wallet) return { ok: false, reason: 'no_wallet' }
  if (!wallet.auto_reload_enabled) return { ok: false, reason: 'disabled' }
  if (!wallet.stripe_customer_id || !wallet.stripe_payment_method_id) return { ok: false, reason: 'no_payment_method' }
  const amount = wallet.auto_reload_amount_cents || 0
  if (amount <= 0) return { ok: false, reason: 'no_amount' }
  if (wallet.auto_reload_pending) return { ok: false, reason: 'already_pending' }

  await deps.setReloadPending(partnerId, true)
  // Stable per-crossing idempotency key: changes after each successful reload (last_auto_reload_at stamp).
  const crossing = wallet.last_auto_reload_at ?? 'init'
  const charge = await deps.chargeOffSession({
    customerId: wallet.stripe_customer_id, paymentMethodId: wallet.stripe_payment_method_id,
    amountCents: amount, currency: wallet.currency, idempotencyKey: `reload:${partnerId}:${crossing}`,
  })
  if (!charge.ok) {
    await deps.setReloadPending(partnerId, false)
    return { ok: false, reason: 'charge_failed' }
  }
  // Credit is idempotent on the PaymentIntent id (webhook + this path can't double-credit).
  await deps.credit(partnerId, amount, { idempotencyKey: `auto_reload:${charge.paymentIntentId}`, stripeRef: charge.paymentIntentId })
  await deps.markReloaded(partnerId)
  return { ok: true, creditedCents: amount }
}

export type FundDecision = 'ok' | 'reloaded' | 'paused'
export interface FundResult { decision: FundDecision; availableCents: number; reason?: string }

// The orchestrator: reload-before-pause. Balance is never driven negative here (only credited or a
// status change); the hard never-negative guarantee stays in apply_balance_txn's debit path.
export async function ensureFunded(partnerId: string): Promise<FundResult> {
  const w = await deps.loadWallet(partnerId)
  if (!w) return { decision: 'paused', availableCents: 0, reason: 'no_wallet' }

  const available = w.balance_cents - w.pending_charge_cents
  const threshold = w.auto_reload_enabled ? (w.auto_reload_threshold_cents ?? 0) : 0

  // Healthy: above the reload threshold and still funded.
  if (available > threshold && available > 0) return { decision: 'ok', availableCents: available }

  // Low → attempt reload first.
  if (w.auto_reload_enabled) {
    const r = await attemptAutoReload(partnerId, w)
    if (r.ok) return { decision: 'reloaded', availableCents: available + (r.creditedCents || 0) }
  }

  // Reload disabled or failed. Pause only when funds are actually depleted; otherwise keep serving
  // (low-but-positive) until the balance is truly exhausted — the debit floor still protects us.
  if (available <= 0) {
    await deps.setStatus(partnerId, 'paused')
    return { decision: 'paused', availableCents: available, reason: 'insufficient_no_reload' }
  }
  return { decision: 'ok', availableCents: available }
}
