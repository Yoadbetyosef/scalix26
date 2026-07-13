import { PLATFORM_PRICE_CENTS } from '@/lib/billing/platform-fee'
import { countActiveClients } from '@/lib/billing/platform-clients'

// ADMIN-ONLY White Label profitability. Combines the two separate billing systems into one internal
// P&L per partner. Provider cost, markup, and gross profit are NEVER exposed to partners (partner
// surfaces show only their own charges). Everything is computed from APPEND-ONLY sources — the wallet
// ledger (partner_balance_transactions) and platform_subscription_events — so any historical window is
// reproducible from the same raw rows.

export interface PartnerFinancials {
  partnerId: string
  name: string
  activeClients: number
  platformStatus: string
  walletBalanceCents: number
  walletReloadsCents: number      // Σ top-ups + auto-reloads (money in)
  usageRevenueCents: number       // Σ partner_charge for usage (what the partner paid us for usage)
  providerCostCents: number       // Σ real provider cost (admin-only)
  platformRevenueCents: number    // Σ paid platform invoices
}

export interface Profitability extends PartnerFinancials {
  mrrCents: number                // active clients × $97
  markupRevenueCents: number      // usage revenue − provider cost
  grossProfitCents: number        // platform revenue + usage revenue − provider cost
  netProviderSpendCents: number   // provider cost
  outstandingCents: number        // unpaid platform cycle when past_due/payment_required
}

// PURE: the P&L identity. Gross Profit = Platform Revenue + Usage Revenue − Provider Cost.
export function computeProfitability(f: PartnerFinancials): Profitability {
  const mrrCents = f.activeClients * PLATFORM_PRICE_CENTS
  const unpaid = f.platformStatus === 'past_due' || f.platformStatus === 'payment_required'
  return {
    ...f,
    mrrCents,
    markupRevenueCents: f.usageRevenueCents - f.providerCostCents,
    grossProfitCents: f.platformRevenueCents + f.usageRevenueCents - f.providerCostCents,
    netProviderSpendCents: f.providerCostCents,
    outstandingCents: unpaid ? mrrCents : 0,
  }
}

interface Txn { partner_id: string; transaction_type: string; amount_cents: number | null; provider_cost_cents: number | null; partner_charge_cents: number | null }
interface PlatEvt { partner_id: string; event_type: string; amount_cents: number | null }
interface Bal { partner_id: string; balance_cents: number | null; platform_fee_status: string | null }

export async function getPartnerProfitability(): Promise<Profitability[]> {
  const { createAdminClient } = await import('@/lib/supabase/server')
  const db = createAdminClient()

  const [partnersRes, txnRes, evtRes, balRes, ownerRes] = await Promise.all([
    db.from('partners').select('id, company_name'),
    db.from('partner_balance_transactions').select('partner_id, transaction_type, amount_cents, provider_cost_cents, partner_charge_cents'),
    db.from('platform_subscription_events').select('partner_id, event_type, amount_cents').eq('event_type', 'invoice_paid'),
    db.from('partner_balances').select('partner_id, balance_cents, platform_fee_status'),
    db.from('tenants').select('white_label_partner_id').not('white_label_partner_id', 'is', null),
  ])

  const txns = (txnRes.data as Txn[]) || []
  const evts = (evtRes.data as PlatEvt[]) || []
  const bals = (balRes.data as Bal[]) || []
  const balByPartner = new Map(bals.map((b) => [b.partner_id, b]))
  const wlPartnerIds = new Set(((ownerRes.data as Array<{ white_label_partner_id: string }>) || []).map((o) => o.white_label_partner_id))

  // Only WL partners: those that own client tenants OR have a wallet/platform state.
  const partners = ((partnersRes.data as Array<{ id: string; company_name: string | null }>) || [])
    .filter((p) => wlPartnerIds.has(p.id) || balByPartner.has(p.id))

  const agg = new Map<string, { reloads: number; usageRev: number; providerCost: number; platformRev: number }>()
  const bump = (id: string) => { let a = agg.get(id); if (!a) { a = { reloads: 0, usageRev: 0, providerCost: 0, platformRev: 0 }; agg.set(id, a) } return a }
  for (const t of txns) {
    const a = bump(t.partner_id)
    if (t.transaction_type === 'top_up' || t.transaction_type === 'auto_reload') a.reloads += Math.abs(Number(t.amount_cents ?? 0))
    if (t.transaction_type === 'usage') { a.usageRev += Number(t.partner_charge_cents ?? 0); a.providerCost += Number(t.provider_cost_cents ?? 0) }
  }
  for (const e of evts) bump(e.partner_id).platformRev += Number(e.amount_cents ?? 0)

  const out: Profitability[] = []
  for (const p of partners) {
    const a = agg.get(p.id) || { reloads: 0, usageRev: 0, providerCost: 0, platformRev: 0 }
    const bal = balByPartner.get(p.id)
    const { activeClients } = await countActiveClients(p.id) // single source of truth (few WL partners)
    out.push(computeProfitability({
      partnerId: p.id,
      name: p.company_name || p.id.slice(0, 8),
      activeClients,
      platformStatus: bal?.platform_fee_status || 'none',
      walletBalanceCents: Number(bal?.balance_cents ?? 0),
      walletReloadsCents: a.reloads,
      usageRevenueCents: a.usageRev,
      providerCostCents: a.providerCost,
      platformRevenueCents: a.platformRev,
    }))
  }
  out.sort((x, y) => y.grossProfitCents - x.grossProfitCents)
  return out
}
