// ─────────────────────────────────────────────────────────────────────────────
// THE pricing service. Every partner charge flows through here — there is no pricing math
// anywhere else. Provider cost → markup engine → partner charge. Nothing is hardcoded: rates come
// from the `provider_rates` rate card and markup from `billing_markup_config` (partner override →
// global default). A safe fallback markup is used only if config is missing (never a zero charge).
//
// Precision: costs are expressed in CENTS but may be FRACTIONAL (a single LLM call is sub-cent).
// Round to whole cents only at the balance boundary, after aggregating a batch — never per event.
// ─────────────────────────────────────────────────────────────────────────────

export type BillingCategory = 'voice' | 'messaging' | 'ai' | 'email' | 'storage' | 'other'

export const DEFAULT_MARKUP_PCT = 25 // fallback ONLY when no markup config row exists

export interface PricedUsage {
  providerCostCents: number   // real provider cost (fractional cents), admin-only
  markupPct: number
  partnerChargeCents: number  // what the partner pays (fractional cents until rounded)
  category: BillingCategory
  currency: string
}

// ── Pure math (fully unit-testable, no I/O) ──────────────────────────────────

// Apply a markup % to a provider cost. Returns fractional cents (do not round here).
export function computeCharge(providerCostCents: number, markupPct: number): number {
  return providerCostCents * (1 + markupPct / 100)
}

// Round to whole cents — call ONLY at the balance-debit boundary (after aggregating).
export function roundCents(value: number): number {
  return Math.round(value)
}

export interface MarkupRow { scope: string; partner_id: string | null; markup_pct: number; currency: string }

// Resolve the markup %: most-specific active scope wins (partner → enterprise → volume → global),
// falling back to DEFAULT_MARKUP_PCT if nothing matches. Pure given the candidate rows.
export function pickMarkupPct(rows: MarkupRow[], partnerId: string | null | undefined, currency: string): number {
  const order = ['partner', 'enterprise', 'volume', 'global']
  for (const scope of order) {
    const row = rows.find(
      (r) => r.scope === scope && r.currency === currency &&
        (scope !== 'partner' || (!!partnerId && r.partner_id === partnerId)),
    )
    if (row) return Number(row.markup_pct)
  }
  return DEFAULT_MARKUP_PCT
}

// ── Injectable data source (overridden in tests so the engine needs no DB) ───

export interface PricingSource {
  loadMarkupRows(partnerId: string | null | undefined, currency: string): Promise<MarkupRow[]>
  loadUnitCost(provider: string, metric: string, currency: string): Promise<number | null>
}

const dbSource: PricingSource = {
  async loadMarkupRows(partnerId, currency) {
    const { createAdminClient } = await import('@/lib/supabase/server') // lazy: keeps next/headers out of unit tests
    const db = createAdminClient()
    // Global always; the partner override too when a partner is in scope.
    let q = db.from('billing_markup_config')
      .select('scope, partner_id, markup_pct, currency')
      .eq('active', true).eq('currency', currency)
    if (partnerId) q = q.or(`scope.eq.global,partner_id.eq.${partnerId}`)
    else q = q.eq('scope', 'global')
    const { data } = await q
    return (data as MarkupRow[]) || []
  },
  async loadUnitCost(provider, metric, currency) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const db = createAdminClient()
    const { data } = await db.from('provider_rates')
      .select('unit_cost')
      .eq('provider', provider).eq('metric', metric).eq('currency', currency).eq('active', true)
      .maybeSingle()
    return data ? Number(data.unit_cost) : null
  },
}

let source: PricingSource = dbSource
// Test seam: inject a deterministic source; pass null to restore the DB source.
export function __setPricingSourceForTests(s: PricingSource | null) {
  source = s ?? dbSource
}

// ── The entry point ──────────────────────────────────────────────────────────

export interface PriceUsageInput {
  category: BillingCategory
  partnerId?: string | null
  currency?: string
  // Provider cost is EITHER supplied directly (e.g. LLM, already computed exactly by llmCost) …
  providerCostCents?: number
  // … OR derived from the rate card: quantity × unit_cost(provider, metric).
  provider?: string
  metric?: string
  quantity?: number
}

// Resolve the effective markup % for a partner (partner override → global → fallback). Exposed so the
// billing cron can resolve it ONCE per partner instead of per event.
export async function resolveMarkupPct(partnerId: string | null | undefined, currency = 'usd'): Promise<number> {
  const rows = await source.loadMarkupRows(partnerId, currency)
  return pickMarkupPct(rows, partnerId, currency)
}

export async function priceUsage(input: PriceUsageInput): Promise<PricedUsage> {
  const currency = input.currency || 'usd'

  let providerCostCents = input.providerCostCents
  if (providerCostCents == null) {
    if (!input.provider || !input.metric || input.quantity == null) {
      throw new Error('priceUsage: provide providerCostCents, or provider+metric+quantity')
    }
    const unitCostUsd = await source.loadUnitCost(input.provider, input.metric, currency)
    providerCostCents = (unitCostUsd ?? 0) * input.quantity * 100 // USD/unit × units × 100 = cents (fractional)
  }

  const markupRows = await source.loadMarkupRows(input.partnerId, currency)
  const markupPct = pickMarkupPct(markupRows, input.partnerId, currency)
  const partnerChargeCents = computeCharge(providerCostCents, markupPct)

  return { providerCostCents, markupPct, partnerChargeCents, category: input.category, currency }
}
