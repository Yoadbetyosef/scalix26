import { createHash } from 'crypto'
import { roundCents } from './pricing'
import { debitBalance } from './balance'
import { ensureFunded } from './reload'

// Billing cron core: roll IMMUTABLE unsettled White Label usage into balance debits. Pricing is NOT
// recomputed here — each event already carries its snapshotted partner_charge_cents (frozen at meter
// time), so historical pricing is preserved and the bill is reproducible. Charges are summed in
// FRACTIONAL cents and rounded ONCE per partner+category batch (sub-cent events never lost). Debits go
// through the balance-safe primitive (never negative); reload-before-pause is attempted first.
// usage_events are never mutated — settlement is recorded in the append-only usage_settlements table.

export interface UsageRow {
  id: string
  partner_id: string
  category: string | null
  cost_usd: number
  partner_charge_cents: number | null // snapshot (fractional cents)
}

export interface CategoryCharge {
  category: string
  events: Array<{ id: string; chargeCents: number }> // per-event rounded charge (for settlement traceability)
  ids: string[]
  providerCostCents: number
  chargeCents: number                                 // authoritative batch charge (round of the fractional sum)
}

// PURE: aggregate a partner's immutable events per category using their snapshotted charges.
export function planCharges(rows: UsageRow[]): CategoryCharge[] {
  const byCat = new Map<string, UsageRow[]>()
  for (const r of rows) { const c = r.category || 'other'; const a = byCat.get(c); if (a) a.push(r); else byCat.set(c, [r]) }
  const out: CategoryCharge[] = []
  for (const [category, cRows] of byCat) {
    let providerFractional = 0, chargeFractional = 0
    const events = cRows.map((r) => {
      providerFractional += Number(r.cost_usd) * 100
      const c = Number(r.partner_charge_cents ?? 0)
      chargeFractional += c
      return { id: r.id, chargeCents: roundCents(c) }
    })
    out.push({
      category, events, ids: cRows.map((r) => r.id),
      providerCostCents: roundCents(providerFractional),
      chargeCents: roundCents(chargeFractional),
    })
  }
  return out
}

export function batchKey(partnerId: string, category: string, ids: string[]): string {
  const h = createHash('sha1').update([...ids].sort().join(',')).digest('hex').slice(0, 16)
  return `usage:${partnerId}:${category}:${h}`
}

export interface BillingCronResult {
  ran: boolean; reason?: string
  partners: number; categoriesBilled: number; eventsSettled: number; debitedCents: number; insufficient: number
}

export function billingEnabled(): boolean {
  return process.env.WL_BILLING_ENABLED === 'true'
}

export async function runBillingCron(opts?: { limit?: number }): Promise<BillingCronResult> {
  const res: BillingCronResult = { ran: false, partners: 0, categoriesBilled: 0, eventsSettled: 0, debitedCents: 0, insufficient: 0 }
  if (!billingEnabled()) { res.reason = 'billing_disabled'; return res }
  res.ran = true

  const { createAdminClient } = await import('@/lib/supabase/server')
  const db = createAdminClient()
  const { data } = await db.from('unsettled_wl_usage')
    .select('id, partner_id, category, cost_usd, partner_charge_cents')
    .order('created_at', { ascending: true }).limit(opts?.limit ?? 1000)
  const rows = (data as UsageRow[]) || []
  if (rows.length === 0) return res

  const byPartner = new Map<string, UsageRow[]>()
  for (const r of rows) { const a = byPartner.get(r.partner_id); if (a) a.push(r); else byPartner.set(r.partner_id, [r]) }

  for (const [partnerId, pRows] of byPartner) {
    res.partners++
    await ensureFunded(partnerId) // reload-before-pause

    for (const cc of planCharges(pRows)) {
      const key = batchKey(partnerId, cc.category, cc.ids)
      const settle = async () => {
        await db.from('usage_settlements').upsert(
          cc.events.map((e) => ({ usage_event_id: e.id, partner_id: partnerId, batch_key: key, charge_cents: e.chargeCents })),
          { onConflict: 'usage_event_id', ignoreDuplicates: true },
        )
        res.eventsSettled += cc.events.length
      }
      if (cc.chargeCents <= 0) { await settle(); continue } // sub-cent aggregate — settle, nothing to charge

      const debit = await debitBalance(partnerId, cc.chargeCents, {
        type: 'usage', idempotencyKey: key, category: cc.category, providerCostCents: cc.providerCostCents,
      })
      if (debit.applied || debit.duplicate) {
        await settle()
        res.categoriesBilled++
        if (debit.applied) res.debitedCents += cc.chargeCents
      } else {
        res.insufficient++ // insufficient_balance → leave unsettled for retry after top-up; partner paused
      }
    }
  }
  return res
}
