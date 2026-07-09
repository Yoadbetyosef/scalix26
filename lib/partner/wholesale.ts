// Pure, isomorphic white-label / reseller pricing types + math. No server imports, so both the
// server resolver and client components can use it. Database-driven — no hardcoded prices.

export interface PriceBookItem {
  id: string; plan_name: string; plan_code: string; wholesale_price_cents: number; suggested_retail_price_cents: number
  setup_fee_cents: number | null; included_ai_employees: number | null; included_phone_numbers: number | null; notes: string | null; sort_order: number
}
export interface PriceBook { id: string; name: string; billing_mode: 'white_label' | 'reseller'; description: string | null; items: PriceBookItem[] }

export interface PartnerClient {
  id: string; business_name: string | null; tenant_id: string | null; plan_code: string | null
  retail_price_cents: number | null; wholesale_price_cents: number | null; status: string; created_at: string
}
export interface WholesaleSummary {
  active_clients: number; total_clients: number
  monthly_retail_cents: number; monthly_wholesale_cents: number; gross_profit_cents: number
  margin_pct: number | null; annual_profit_cents: number; has_pricing: boolean
  new_this_month: number; churned: number; pending_payments_cents: number
}

// Build the summary shape from SQL-aggregated counts/sums (scale-safe — never sums client rows in
// the app). `agg` comes from the partner_wholesale_summary() Postgres function.
export function summaryFromAggregate(agg: {
  active_clients: number; total_clients: number; monthly_retail_cents: number; monthly_wholesale_cents: number
  new_this_month: number; churned_clients: number; priced_clients: number
}): WholesaleSummary {
  const retail = Number(agg.monthly_retail_cents) || 0
  const wholesale = Number(agg.monthly_wholesale_cents) || 0
  const profit = retail - wholesale
  return {
    active_clients: Number(agg.active_clients) || 0, total_clients: Number(agg.total_clients) || 0,
    monthly_retail_cents: retail, monthly_wholesale_cents: wholesale, gross_profit_cents: profit,
    margin_pct: retail > 0 ? Math.round((profit / retail) * 100) : null, annual_profit_cents: profit * 12,
    has_pricing: (Number(agg.priced_clients) || 0) > 0,
    new_this_month: Number(agg.new_this_month) || 0, churned: Number(agg.churned_clients) || 0,
    pending_payments_cents: wholesale,
  }
}

// Effective per-plan pricing after the partner's optional custom discount / markup overrides.
export function effectiveItemPricing(item: PriceBookItem, o: { customWholesaleDiscountPct: number | null; retailMarkupPct: number | null }): { wholesale_cents: number; retail_cents: number; margin_cents: number; margin_pct: number } {
  const wholesale = o.customWholesaleDiscountPct != null ? Math.round(item.wholesale_price_cents * (1 - o.customWholesaleDiscountPct / 100)) : item.wholesale_price_cents
  const retail = o.retailMarkupPct != null ? Math.round(item.suggested_retail_price_cents * (1 + o.retailMarkupPct / 100)) : item.suggested_retail_price_cents
  const margin = retail - wholesale
  return { wholesale_cents: wholesale, retail_cents: retail, margin_cents: margin, margin_pct: retail > 0 ? Math.round((margin / retail) * 100) : 0 }
}

// Small-set fallback summary (used only where the row set is already bounded). The scaled path uses
// summaryFromAggregate() over the SQL aggregate.
export function computeWholesaleSummary(clients: PartnerClient[]): WholesaleSummary {
  const active = clients.filter((c) => c.status === 'active')
  const priced = active.filter((c) => (c.retail_price_cents || 0) > 0 || (c.wholesale_price_cents || 0) > 0)
  const retail = priced.reduce((s, c) => s + (c.retail_price_cents || 0), 0)
  const wholesale = priced.reduce((s, c) => s + (c.wholesale_price_cents || 0), 0)
  const profit = retail - wholesale
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  return {
    active_clients: active.length, total_clients: clients.length,
    monthly_retail_cents: retail, monthly_wholesale_cents: wholesale, gross_profit_cents: profit,
    margin_pct: retail > 0 ? Math.round((profit / retail) * 100) : null, annual_profit_cents: profit * 12,
    has_pricing: priced.length > 0,
    new_this_month: clients.filter((c) => c.created_at >= monthStart).length,
    churned: clients.filter((c) => c.status === 'churned').length, pending_payments_cents: wholesale,
  }
}
