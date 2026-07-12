import { createAdminClient } from '@/lib/supabase/server'
import { roundCents } from './pricing'

// Balance operations — the ONE writer of the wallet. Every mutation goes through the atomic,
// idempotent `apply_balance_txn` RPC (ledger insert is the dedupe gate + happens before the cache
// update, so a duplicate idempotency_key can never double-apply). Balance is stored in whole cents;
// callers pass fractional charge amounts which are rounded to cents here at the boundary.

export type TxnType = 'top_up' | 'usage' | 'auto_reload' | 'platform_fee' | 'adjustment' | 'refund' | 'chargeback'

export type TxnOutcome = 'applied' | 'duplicate' | 'insufficient_balance'

export interface BalanceTxnResult {
  applied: boolean
  duplicate: boolean
  result: TxnOutcome
  balanceCents: number
  // Set only when result === 'insufficient_balance' — how far short the debit was.
  shortfallCents?: number
}

export interface ApplyArgs {
  partnerId: string
  type: TxnType
  amountCents: number // SIGNED whole cents: positive = credit, negative = debit
  idempotencyKey: string
  category?: string | null
  currency?: string
  providerCostCents?: number | null
  markupPct?: number | null
  partnerChargeCents?: number | null
  provider?: string | null
  usageEventId?: string | null
  stripeRef?: string | null
}

export async function applyBalanceTxn(a: ApplyArgs): Promise<BalanceTxnResult> {
  const db = createAdminClient()
  const { data, error } = await db.rpc('apply_balance_txn', {
    p_partner_id: a.partnerId,
    p_type: a.type,
    p_amount_cents: Math.trunc(a.amountCents),
    p_idempotency_key: a.idempotencyKey,
    p_category: a.category ?? null,
    p_currency: a.currency ?? 'usd',
    p_provider_cost_cents: a.providerCostCents != null ? roundCents(a.providerCostCents) : null,
    p_markup_pct: a.markupPct ?? null,
    p_partner_charge_cents: a.partnerChargeCents != null ? roundCents(a.partnerChargeCents) : null,
    p_provider: a.provider ?? null,
    p_usage_event_id: a.usageEventId ?? null,
    p_stripe_ref: a.stripeRef ?? null,
  })
  if (error) throw new Error(`applyBalanceTxn failed: ${error.message}`)
  const r = data as { applied: boolean; duplicate: boolean; result: TxnOutcome; balance_cents: number; shortfall_cents?: number }
  return {
    applied: r.applied,
    duplicate: r.duplicate,
    result: r.result,
    balanceCents: Number(r.balance_cents),
    ...(r.shortfall_cents != null ? { shortfallCents: Number(r.shortfall_cents) } : {}),
  }
}

// Credit the wallet (top-up, auto-reload, refund, positive adjustment).
export async function creditBalance(
  partnerId: string,
  amountCents: number,
  opts: { type: TxnType; idempotencyKey: string; category?: string | null; stripeRef?: string | null; currency?: string },
): Promise<BalanceTxnResult> {
  return applyBalanceTxn({ partnerId, amountCents: roundCents(Math.abs(amountCents)), ...opts })
}

// Debit the wallet for usage / platform fee. `chargeCents` may be fractional; rounded to cents here.
export async function debitBalance(
  partnerId: string,
  chargeCents: number,
  opts: {
    type: TxnType; idempotencyKey: string; category?: string | null; currency?: string
    providerCostCents?: number | null; markupPct?: number | null; provider?: string | null; usageEventId?: string | null
  },
): Promise<BalanceTxnResult> {
  const whole = roundCents(Math.abs(chargeCents))
  return applyBalanceTxn({
    partnerId, amountCents: -whole, partnerChargeCents: whole, ...opts,
  })
}

export interface BalanceSnapshot { balanceCents: number; status: 'active' | 'paused'; currency: string }

export async function getBalance(partnerId: string): Promise<BalanceSnapshot | null> {
  const db = createAdminClient()
  const { data } = await db.from('partner_balances')
    .select('balance_cents, status, currency').eq('partner_id', partnerId).maybeSingle()
  if (!data) return null
  return { balanceCents: Number(data.balance_cents), status: data.status, currency: data.currency }
}
