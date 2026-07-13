// Actual business data — read ONLY from verified existing sources. Anything not reliably derivable is
// marked 'manual' with a null value (never faked). Every metric is labeled Actual (derived) vs Manual;
// the UI pairs these with Forecast/Target/Variance. DB access is behind an injectable seam.

export type MetricSource = 'derived' | 'manual'
export type MetricUnit = 'count' | 'cents'
export interface ActualMetric {
  key: string
  label: string
  value: number | null // null = not yet derivable (Manual, awaiting input)
  source: MetricSource
  unit: MetricUnit
  asOf: string
}

export interface ActualsDeps {
  activeCustomersByEngine(): Promise<{ direct: number; affiliate: number; whiteLabel: number }>
  platformRevenueCents(): Promise<number>
  usageEconomics(): Promise<{ providerCostCents: number; markupRevenueCents: number }>
}

const dbDeps: ActualsDeps = {
  async activeCustomersByEngine() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('tenants')
      .select('white_label_partner_id, referred_by_partner_id').is('suspended_at', null)
    const rows = (data as Array<{ white_label_partner_id: string | null; referred_by_partner_id: string | null }> | null) ?? []
    let direct = 0, affiliate = 0, whiteLabel = 0
    for (const t of rows) {
      if (t.white_label_partner_id) whiteLabel++
      else if (t.referred_by_partner_id) affiliate++
      else direct++
    }
    return { direct, affiliate, whiteLabel }
  },
  async platformRevenueCents() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('platform_subscription_events').select('amount_cents').eq('event_type', 'invoice_paid')
    return ((data as Array<{ amount_cents: number | null }> | null) ?? []).reduce((s, r) => s + Number(r.amount_cents ?? 0), 0)
  },
  async usageEconomics() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('partner_balance_transactions').select('provider_cost_cents, partner_charge_cents').eq('transaction_type', 'usage')
    const rows = (data as Array<{ provider_cost_cents: number | null; partner_charge_cents: number | null }> | null) ?? []
    const providerCostCents = rows.reduce((s, r) => s + Number(r.provider_cost_cents ?? 0), 0)
    const revenue = rows.reduce((s, r) => s + Number(r.partner_charge_cents ?? 0), 0)
    return { providerCostCents, markupRevenueCents: revenue - providerCostCents }
  },
}
let deps: ActualsDeps = dbDeps
export function __setActualsDepsForTests(d: ActualsDeps | null) { deps = d ?? dbDeps }

export async function getActuals(asOf: string): Promise<ActualMetric[]> {
  const [byEngine, platformRev, usage] = await Promise.all([
    deps.activeCustomersByEngine(), deps.platformRevenueCents(), deps.usageEconomics(),
  ])
  const total = byEngine.direct + byEngine.affiliate + byEngine.whiteLabel
  const derived = (key: string, label: string, value: number, unit: MetricUnit): ActualMetric => ({ key, label, value, source: 'derived', unit, asOf })
  const manual = (key: string, label: string, unit: MetricUnit): ActualMetric => ({ key, label, value: null, source: 'manual', unit, asOf })
  return [
    derived('customers', 'Active customers', total, 'count'),
    derived('directCustomers', 'Direct customers', byEngine.direct, 'count'),
    derived('affiliateCustomers', 'Affiliate customers', byEngine.affiliate, 'count'),
    derived('whiteLabelCustomers', 'White Label customers', byEngine.whiteLabel, 'count'),
    derived('platformRevenueCents', 'Platform-fee revenue (collected)', platformRev, 'cents'),
    derived('providerCostCents', 'Provider cost (usage)', usage.providerCostCents, 'cents'),
    derived('markupRevenueCents', 'Usage markup revenue', usage.markupRevenueCents, 'cents'),
    // Not reliably derivable yet → Manual (never faked). Wired to real sources in a later pass.
    manual('mrrCents', 'Total MRR', 'cents'),
    manual('cashCents', 'Cash balance', 'cents'),
    manual('payrollCents', 'Monthly payroll', 'cents'),
  ]
}
