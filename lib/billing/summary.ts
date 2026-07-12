import { createAdminClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { TRANSACTION_TYPES, type TransactionType } from './ledger'

// Partner-facing balance summary. Exposes ONLY partner-safe fields — never provider names, provider
// cost, or markup (those are admin-only). Usage is bucketed by business CATEGORY.

export interface BalanceTxnView {
  id: string; type: TransactionType; label: string; category: string | null
  amountCents: number; currency: string; createdAt: string
}
export interface BalanceSummary {
  balanceCents: number
  status: 'active' | 'paused' | 'payment_required'
  currency: string
  lowBalance: boolean
  lowBalanceThresholdCents: number
  autoReload: { enabled: boolean; thresholdCents: number | null; amountCents: number | null }
  savedCard: { brand: string; last4: string } | null
  monthlyUsageCents: number
  usageByCategory: Record<string, number>
  estimatedDaysRemaining: number | null
  transactions: BalanceTxnView[]
}

export async function getPartnerBalanceSummary(partnerId: string): Promise<BalanceSummary> {
  const db = createAdminClient()
  const { data: bal } = await db.from('partner_balances').select('*').eq('partner_id', partnerId).maybeSingle()
  const balance = Number(bal?.balance_cents ?? 0)
  const lowThreshold = Number(bal?.low_balance_threshold_cents ?? 10000)

  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
  const [{ data: txns }, { data: monthTxns }, { data: burnTxns }] = await Promise.all([
    db.from('partner_balance_transactions')
      .select('id, transaction_type, category, amount_cents, currency, created_at')
      .eq('partner_id', partnerId).order('created_at', { ascending: false }).limit(50),
    db.from('partner_balance_transactions').select('category, amount_cents')
      .eq('partner_id', partnerId).eq('transaction_type', 'usage').gte('created_at', monthStart.toISOString()),
    db.from('partner_balance_transactions').select('amount_cents')
      .eq('partner_id', partnerId).eq('transaction_type', 'usage')
      .gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString()),
  ])

  const usageByCategory: Record<string, number> = {}
  let monthlyUsage = 0
  for (const t of monthTxns || []) {
    const c = t.category || 'other'; const a = Math.abs(Number(t.amount_cents))
    usageByCategory[c] = (usageByCategory[c] || 0) + a; monthlyUsage += a
  }
  const burn30 = (burnTxns || []).reduce((s, t) => s + Math.abs(Number(t.amount_cents)), 0)
  const avgDaily = burn30 / 30
  const estimatedDaysRemaining = avgDaily > 0 ? Math.max(0, Math.floor(balance / avgDaily)) : null

  let savedCard: { brand: string; last4: string } | null = null
  if (bal?.stripe_payment_method_id && stripe) {
    try {
      const pm = await stripe.paymentMethods.retrieve(bal.stripe_payment_method_id)
      if (pm.card) savedCard = { brand: pm.card.brand, last4: pm.card.last4 }
    } catch { /* card lookup is best-effort */ }
  }

  return {
    balanceCents: balance,
    status: (bal?.status as BalanceSummary['status']) ?? 'active',
    currency: bal?.currency ?? 'usd',
    lowBalance: balance < lowThreshold,
    lowBalanceThresholdCents: lowThreshold,
    autoReload: {
      enabled: !!bal?.auto_reload_enabled,
      thresholdCents: bal?.auto_reload_threshold_cents != null ? Number(bal.auto_reload_threshold_cents) : null,
      amountCents: bal?.auto_reload_amount_cents != null ? Number(bal.auto_reload_amount_cents) : null,
    },
    savedCard,
    monthlyUsageCents: monthlyUsage,
    usageByCategory,
    estimatedDaysRemaining,
    transactions: (txns || []).map((t) => ({
      id: t.id, type: t.transaction_type as TransactionType,
      label: TRANSACTION_TYPES[t.transaction_type as TransactionType]?.label ?? t.transaction_type,
      category: t.category, amountCents: Number(t.amount_cents), currency: t.currency, createdAt: t.created_at,
    })),
  }
}
