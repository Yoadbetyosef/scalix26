import { createHash } from 'crypto'
import { computeCharge, roundCents, resolveMarkupPct } from './pricing'
import { debitBalance } from './balance'
import { ensureFunded } from './reload'

// Billing cron core: price unpriced White Label usage, aggregate per partner+category, and debit the
// balance through the SAFE primitive (never negative). Reload-before-pause is attempted first. On
// insufficient funds the batch is left unpriced (retried after top-up) and the partner is paused.
//
// Precision: provider cost (usage_events.cost_usd) is summed in FRACTIONAL cents and rounded ONCE per
// partner+category batch — sub-cent AI events are never lost to per-event rounding.

export interface UsageRow { id: string; partner_id: string; category: string | null; cost_usd: number }

export interface CategoryCharge {
  category: string
  ids: string[]
  providerCostCents: number  // rounded
  chargeCents: number        // rounded, post-markup
}

// PURE: turn a partner's unpriced events + their markup into per-category rounded charges.
export function planCharges(rows: UsageRow[], markupPct: number): CategoryCharge[] {
  const byCat = new Map<string, UsageRow[]>()
  for (const r of rows) {
    const c = r.category || 'other'
    const a = byCat.get(c)
    if (a) a.push(r); else byCat.set(c, [r])
  }
  const out: CategoryCharge[] = []
  for (const [category, cRows] of byCat) {
    let providerFractional = 0, chargeFractional = 0
    for (const r of cRows) {
      const providerCents = Number(r.cost_usd) * 100
      providerFractional += providerCents
      chargeFractional += computeCharge(providerCents, markupPct)
    }
    out.push({
      category,
      ids: cRows.map((r) => r.id).sort(),
      providerCostCents: roundCents(providerFractional),
      chargeCents: roundCents(chargeFractional),
    })
  }
  return out
}

// Stable idempotency key for a partner+category batch (the exact id-set). A rerun of an unmarked
// batch reuses the key → the debit is a no-op, then marking priced completes → no double charge.
export function batchKey(partnerId: string, category: string, ids: string[]): string {
  const h = createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 16)
  return `usage:${partnerId}:${category}:${h}`
}

export interface BillingCronResult {
  ran: boolean; reason?: string
  partners: number; categoriesBilled: number; eventsPriced: number; debitedCents: number; insufficient: number
}

export function billingEnabled(): boolean {
  return process.env.WL_BILLING_ENABLED === 'true'
}

export async function runBillingCron(opts?: { limit?: number }): Promise<BillingCronResult> {
  const res: BillingCronResult = { ran: false, partners: 0, categoriesBilled: 0, eventsPriced: 0, debitedCents: 0, insufficient: 0 }
  // Fail-closed: no charging until billing is explicitly enabled (after partners can fund + gating is live).
  if (!billingEnabled()) { res.reason = 'billing_disabled'; return res }
  res.ran = true

  const { createAdminClient } = await import('@/lib/supabase/server')
  const db = createAdminClient()
  const { data } = await db.from('usage_events')
    .select('id, partner_id, category, cost_usd')
    .not('partner_id', 'is', null).eq('priced', false)
    .order('created_at', { ascending: true }).limit(opts?.limit ?? 1000)
  const rows = (data as UsageRow[]) || []
  if (rows.length === 0) return res

  const byPartner = new Map<string, UsageRow[]>()
  for (const r of rows) { const a = byPartner.get(r.partner_id); if (a) a.push(r); else byPartner.set(r.partner_id, [r]) }

  for (const [partnerId, pRows] of byPartner) {
    res.partners++
    const markup = await resolveMarkupPct(partnerId, 'usd')
    await ensureFunded(partnerId) // reload-before-pause: top up if low before debiting

    for (const cc of planCharges(pRows, markup)) {
      if (cc.chargeCents <= 0) {
        // Sub-cent aggregate — nothing to charge yet; mark priced so we don't rescan forever.
        await db.from('usage_events').update({ priced: true }).in('id', cc.ids)
        res.eventsPriced += cc.ids.length
        continue
      }
      const debit = await debitBalance(partnerId, cc.chargeCents, {
        type: 'usage', idempotencyKey: batchKey(partnerId, cc.category, cc.ids),
        category: cc.category, providerCostCents: cc.providerCostCents, markupPct: markup,
      })
      if (debit.applied || debit.duplicate) {
        // The authoritative charge is the ledger row (one per partner+category batch). We only flag the
        // events priced; per-event partner_charge_cents is intentionally left null to avoid a column
        // whose naive SUM would double-count the batch total.
        await db.from('usage_events').update({ priced: true }).in('id', cc.ids)
        res.categoriesBilled++; res.eventsPriced += cc.ids.length
        if (debit.applied) res.debitedCents += cc.chargeCents
      } else {
        // insufficient_balance → leave unpriced for retry after top-up; partner now payment_required.
        res.insufficient++
      }
    }
  }
  return res
}
