import { countActiveClients } from './platform-clients'

// White Label PLATFORM subscription — $97/mo per ACTIVE client, billed as ONE Stripe subscription per
// partner with a dynamic quantity. This is a SEPARATE billing system from the usage wallet: it charges
// the partner's card and NEVER touches partner_balances.balance_cents or the usage ledger. All history
// lands in the append-only platform_subscription_events table (reproducible reporting).
//
// SAFETY: every Stripe write (create subscription, update quantity) and every dunning transition is
// INERT unless WL_PLATFORM_FEE_ENABLED=true. Nothing here runs automatically. DB/Stripe access is behind
// an injectable `deps` seam so the whole state machine — quantity sync, idempotency, grace, restore — is
// unit-testable with no Stripe and no database.

export const PLATFORM_PRICE_CENTS = 9700 // $97.00 / active client / month
const DEFAULT_GRACE_DAYS = 7

export function platformFeeEnabled(): boolean {
  return process.env.WL_PLATFORM_FEE_ENABLED === 'true'
}
export function platformGraceMs(): number {
  const d = parseInt(process.env.WL_PLATFORM_GRACE_DAYS || '', 10)
  return (Number.isFinite(d) && d >= 0 ? d : DEFAULT_GRACE_DAYS) * 86_400_000
}
export function platformPriceId(): string | undefined {
  return process.env.STRIPE_WL_PLATFORM_PRICE_ID || undefined
}

// Gate for the ADMIN manual per-partner force-sync (app/api/admin/wl-billing/partners/[id]/sync). This is
// a deliberately narrow capability used to drive/verify a SINGLE partner without the global cron. It is
// allowed ONLY when the platform fee is enabled AND we're in a Preview deployment — so a production
// force-sync can never be exposed by accident. A future prod rollout must set WL_PLATFORM_ADMIN_SYNC_PROD
// explicitly. NOTE: this only controls the manual trigger; the actual billing engine is unchanged.
export function platformAdminSyncAllowed(): boolean {
  if (!platformFeeEnabled()) return false
  if (process.env.VERCEL_ENV === 'preview') return true
  if (process.env.WL_PLATFORM_ADMIN_SYNC_PROD === 'true') return true
  return false
}

export type PlatformStatus = 'none' | 'active' | 'past_due' | 'payment_required' | 'canceled'
export type PlatformEventType =
  | 'created' | 'quantity_changed' | 'invoice_paid' | 'invoice_failed'
  | 'grace_started' | 'payment_required' | 'restored' | 'canceled'

export interface PlatformState {
  partnerId: string
  subscriptionId: string | null
  itemId: string | null
  activeQty: number
  status: PlatformStatus
  graceUntil: string | null
  currentPeriodEnd: string | null
  customerId: string | null
}

export interface PlatformEvent {
  partnerId: string
  eventType: PlatformEventType
  quantity?: number | null
  amountCents?: number | null
  currency?: string
  previousStatus?: PlatformStatus | null
  newStatus?: PlatformStatus | null
  stripeRef?: string | null
  stripeSubscriptionId?: string | null
  idempotencyKey: string
  metadata?: Record<string, unknown> | null
}

export interface PlatformDeps {
  countActive(partnerId: string): Promise<number>
  loadState(partnerId: string): Promise<PlatformState>
  ensureCustomer(partnerId: string): Promise<string>
  createSubscription(a: { partnerId: string; customerId: string; quantity: number }):
    Promise<{ subscriptionId: string; itemId: string; currentPeriodEnd: string | null; status: string }>
  updateQuantity(a: { subscriptionId: string; itemId: string; quantity: number }): Promise<void>
  saveState(partnerId: string, patch: Partial<Omit<PlatformState, 'partnerId'>>): Promise<void>
  // Append to platform_subscription_events; returns false when idempotency_key already existed (duplicate).
  recordEvent(e: PlatformEvent): Promise<boolean>
}

// ── Real deps (lazy-imported so unit tests never load Stripe or next/headers) ────────────────────────
const dbDeps: PlatformDeps = {
  async countActive(partnerId) { return (await countActiveClients(partnerId)).activeClients },
  async loadState(partnerId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('partner_balances')
      .select('platform_subscription_id, platform_subscription_item_id, platform_active_qty, platform_fee_status, platform_grace_until, platform_current_period_end, stripe_customer_id')
      .eq('partner_id', partnerId).maybeSingle()
    return {
      partnerId,
      subscriptionId: data?.platform_subscription_id ?? null,
      itemId: data?.platform_subscription_item_id ?? null,
      activeQty: Number(data?.platform_active_qty ?? 0),
      status: (data?.platform_fee_status as PlatformStatus) ?? 'none',
      graceUntil: data?.platform_grace_until ?? null,
      currentPeriodEnd: data?.platform_current_period_end ?? null,
      customerId: data?.stripe_customer_id ?? null,
    }
  },
  async ensureCustomer(partnerId) {
    const { ensureStripeCustomer } = await import('./topup')
    return ensureStripeCustomer(partnerId)
  },
  async createSubscription({ partnerId, customerId, quantity }) {
    const { stripe } = await import('@/lib/stripe/client')
    const { createAdminClient } = await import('@/lib/supabase/server')
    const price = platformPriceId()
    if (!price) throw new Error('STRIPE_WL_PLATFORM_PRICE_ID is not configured')
    const { data: bal } = await createAdminClient().from('partner_balances')
      .select('stripe_payment_method_id').eq('partner_id', partnerId).maybeSingle()
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price, quantity }],
      metadata: { kind: 'wl_platform_fee', partner_id: partnerId },
      ...(bal?.stripe_payment_method_id ? { default_payment_method: bal.stripe_payment_method_id } : {}),
    }, { idempotencyKey: `wl_platform_sub:${partnerId}` })
    const cpe = (sub as unknown as { current_period_end?: number }).current_period_end
    return {
      subscriptionId: sub.id,
      itemId: sub.items.data[0]?.id ?? '',
      currentPeriodEnd: cpe ? new Date(cpe * 1000).toISOString() : null,
      status: sub.status,
    }
  },
  async updateQuantity({ subscriptionId, itemId, quantity }) {
    const { stripe } = await import('@/lib/stripe/client')
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, quantity }],
      proration_behavior: 'create_prorations',
    })
  },
  async saveState(partnerId, patch) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const row: Record<string, unknown> = { partner_id: partnerId }
    if ('subscriptionId' in patch) row.platform_subscription_id = patch.subscriptionId
    if ('itemId' in patch) row.platform_subscription_item_id = patch.itemId
    if ('activeQty' in patch) row.platform_active_qty = patch.activeQty
    if ('status' in patch) row.platform_fee_status = patch.status
    if ('graceUntil' in patch) row.platform_grace_until = patch.graceUntil
    if ('currentPeriodEnd' in patch) row.platform_current_period_end = patch.currentPeriodEnd
    await createAdminClient().from('partner_balances').upsert(row, { onConflict: 'partner_id' })
  },
  async recordEvent(e) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { error } = await createAdminClient().from('platform_subscription_events').insert({
      partner_id: e.partnerId, event_type: e.eventType, quantity: e.quantity ?? null,
      amount_cents: e.amountCents ?? null, currency: e.currency ?? 'usd',
      previous_status: e.previousStatus ?? null, new_status: e.newStatus ?? null,
      stripe_ref: e.stripeRef ?? null, stripe_subscription_id: e.stripeSubscriptionId ?? null,
      idempotency_key: e.idempotencyKey, metadata: e.metadata ?? null,
    })
    if (error) { if (error.code === '23505') return false; throw new Error(`recordEvent failed: ${error.message}`) }
    return true
  },
}

let deps: PlatformDeps = dbDeps
export function __setPlatformDepsForTests(d: PlatformDeps | null) { deps = d ?? dbDeps }

export type SyncAction = 'skipped' | 'no_subscription' | 'created' | 'increased' | 'decreased' | 'unchanged'
export interface SyncResult { action: SyncAction; quantity: number }

// Idempotent quantity synchronization: recompute the active-client count and set the subscription
// quantity to exactly that. Recompute-and-set (not +1/-1) makes duplicate calls a no-op. Records a
// history event ONLY on an actual change. Creates the ONE subscription the first time qty >= 1; never
// creates a second. INERT unless WL_PLATFORM_FEE_ENABLED=true.
export async function syncPlatformQuantity(partnerId: string): Promise<SyncResult> {
  if (!platformFeeEnabled()) return { action: 'skipped', quantity: 0 }
  const qty = await deps.countActive(partnerId)
  const state = await deps.loadState(partnerId)

  if (!state.subscriptionId) {
    if (qty < 1) return { action: 'no_subscription', quantity: qty } // nothing to bill yet
    const customerId = state.customerId ?? (await deps.ensureCustomer(partnerId))
    const sub = await deps.createSubscription({ partnerId, customerId, quantity: qty })
    await deps.saveState(partnerId, {
      subscriptionId: sub.subscriptionId, itemId: sub.itemId, activeQty: qty,
      status: 'active', currentPeriodEnd: sub.currentPeriodEnd,
    })
    await deps.recordEvent({
      partnerId, eventType: 'created', quantity: qty, newStatus: 'active',
      stripeSubscriptionId: sub.subscriptionId, idempotencyKey: `created:${sub.subscriptionId}`,
    })
    return { action: 'created', quantity: qty }
  }

  if (qty === state.activeQty) return { action: 'unchanged', quantity: qty } // idempotent no-op
  await deps.updateQuantity({ subscriptionId: state.subscriptionId, itemId: state.itemId ?? '', quantity: qty })
  await deps.saveState(partnerId, { activeQty: qty })
  await deps.recordEvent({
    partnerId, eventType: 'quantity_changed', quantity: qty,
    stripeSubscriptionId: state.subscriptionId,
    idempotencyKey: `qty:${state.subscriptionId}:${state.activeQty}->${qty}`,
    metadata: { from: state.activeQty, to: qty },
  })
  return { action: qty > state.activeQty ? 'increased' : 'decreased', quantity: qty }
}

// Invoice paid → active + clear grace + record. Idempotent on the invoice event id.
export async function onPlatformInvoicePaid(
  partnerId: string,
  a: { invoiceId: string; amountCents: number; currency?: string; periodEnd?: string | null; subscriptionId?: string | null },
): Promise<{ applied: boolean }> {
  const fresh = await deps.recordEvent({
    partnerId, eventType: 'invoice_paid', amountCents: a.amountCents, currency: a.currency,
    stripeRef: a.invoiceId, stripeSubscriptionId: a.subscriptionId ?? null,
    idempotencyKey: `invoice_paid:${a.invoiceId}`, newStatus: 'active',
  })
  if (!fresh) return { applied: false } // duplicate webhook → no double transition
  const prev = (await deps.loadState(partnerId)).status
  await deps.saveState(partnerId, { status: 'active', graceUntil: null, ...(a.periodEnd ? { currentPeriodEnd: a.periodEnd } : {}) })
  if (prev === 'past_due' || prev === 'payment_required') {
    await deps.recordEvent({ partnerId, eventType: 'restored', previousStatus: prev, newStatus: 'active', stripeRef: a.invoiceId, idempotencyKey: `restored:${a.invoiceId}` })
  }
  return { applied: true }
}

// Invoice failed → past_due + start grace window (NOT gated yet). Idempotent on the invoice event id.
export async function onPlatformInvoiceFailed(
  partnerId: string,
  a: { invoiceId: string; amountCents?: number; subscriptionId?: string | null },
  nowMs: number,
): Promise<{ applied: boolean; graceUntil: string }> {
  const graceUntil = new Date(nowMs + platformGraceMs()).toISOString()
  const fresh = await deps.recordEvent({
    partnerId, eventType: 'invoice_failed', amountCents: a.amountCents ?? null,
    stripeRef: a.invoiceId, stripeSubscriptionId: a.subscriptionId ?? null,
    idempotencyKey: `invoice_failed:${a.invoiceId}`, newStatus: 'past_due',
  })
  if (!fresh) return { applied: false, graceUntil }
  await deps.saveState(partnerId, { status: 'past_due', graceUntil })
  await deps.recordEvent({ partnerId, eventType: 'grace_started', newStatus: 'past_due', metadata: { graceUntil }, idempotencyKey: `grace_started:${a.invoiceId}` })
  return { applied: true, graceUntil }
}

// Grace expiry sweep → past_due whose grace window has closed becomes payment_required (gate then blocks).
// Idempotent: only the past_due→payment_required transition fires an event.
export async function expirePlatformGraceIfDue(partnerId: string, nowMs: number): Promise<{ transitioned: boolean }> {
  const s = await deps.loadState(partnerId)
  if (s.status !== 'past_due') return { transitioned: false }
  if (!s.graceUntil || new Date(s.graceUntil).getTime() > nowMs) return { transitioned: false }
  await deps.saveState(partnerId, { status: 'payment_required' })
  await deps.recordEvent({ partnerId, eventType: 'payment_required', previousStatus: 'past_due', newStatus: 'payment_required', idempotencyKey: `payment_required:${partnerId}:${s.graceUntil}` })
  return { transitioned: true }
}

// Subscription canceled (in Stripe) → terminal canceled state.
export async function onPlatformSubscriptionCanceled(partnerId: string, a: { subscriptionId: string }): Promise<{ applied: boolean }> {
  const fresh = await deps.recordEvent({ partnerId, eventType: 'canceled', newStatus: 'canceled', stripeSubscriptionId: a.subscriptionId, idempotencyKey: `canceled:${a.subscriptionId}` })
  if (!fresh) return { applied: false }
  await deps.saveState(partnerId, { status: 'canceled' })
  return { applied: true }
}
