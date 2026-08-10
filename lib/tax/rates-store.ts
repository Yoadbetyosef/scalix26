import { createAdminClient } from '@/lib/supabase/server'
import { CA_RATES_FALLBACK, type TaxRate } from './canada'

// Loading the rate table.
//
// The DATABASE is authoritative — rates change, and a rate compiled into the application means a
// deploy to correct arithmetic that is already wrong on documents that have gone out.
//
// The bundled table in canada.ts is the fallback, used when the table does not exist yet or the read
// fails. Falling back rather than throwing is deliberate: a missing tax line on a customer's invoice
// is a commercial error, and a slightly stale rate is a smaller one than no rate at all.

export async function loadTaxRates(country = 'CA'): Promise<TaxRate[]> {
  try {
    const { data, error } = await createAdminClient()
      .from('tax_rates').select('region, label, rate_percent, effective_from').eq('country', country)
    if (error || !data || data.length === 0) return CA_RATES_FALLBACK
    return (data as Array<Record<string, unknown>>).map((r) => ({
      region: r.region as string,
      label: r.label as string,
      ratePercent: Number(r.rate_percent),
      effectiveFrom: String(r.effective_from).slice(0, 10),
    }))
  } catch {
    return CA_RATES_FALLBACK
  }
}
