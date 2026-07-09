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
}

// Effective per-plan pricing after the partner's optional custom discount / markup overrides.
export function effectiveItemPricing(item: PriceBookItem, o: { customWholesaleDiscountPct: number | null; retailMarkupPct: number | null }): { wholesale_cents: number; retail_cents: number; margin_cents: number; margin_pct: number } {
  const wholesale = o.customWholesaleDiscountPct != null ? Math.round(item.wholesale_price_cents * (1 - o.customWholesaleDiscountPct / 100)) : item.wholesale_price_cents
  const retail = o.retailMarkupPct != null ? Math.round(item.suggested_retail_price_cents * (1 + o.retailMarkupPct / 100)) : item.suggested_retail_price_cents
  const margin = retail - wholesale
  return { wholesale_cents: wholesale, retail_cents: retail, margin_cents: margin, margin_pct: retail > 0 ? Math.round((margin / retail) * 100) : 0 }
}

// Margin summary from real client rows — active + priced clients only. No fake data.
export function computeWholesaleSummary(clients: PartnerClient[]): WholesaleSummary {
  const active = clients.filter((c) => c.status === 'active')
  const priced = active.filter((c) => (c.retail_price_cents || 0) > 0 || (c.wholesale_price_cents || 0) > 0)
  const retail = priced.reduce((s, c) => s + (c.retail_price_cents || 0), 0)
  const wholesale = priced.reduce((s, c) => s + (c.wholesale_price_cents || 0), 0)
  const profit = retail - wholesale
  return {
    active_clients: active.length, total_clients: clients.length,
    monthly_retail_cents: retail, monthly_wholesale_cents: wholesale, gross_profit_cents: profit,
    margin_pct: retail > 0 ? Math.round((profit / retail) * 100) : null, annual_profit_cents: profit * 12,
    has_pricing: priced.length > 0,
  }
}
