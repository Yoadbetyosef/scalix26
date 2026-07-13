import { getActuals } from '@/lib/command-center/actuals'
import { runForecast } from '@/lib/command-center/engine'
import { loadActiveAssumptions } from '@/lib/command-center/active'
import { getFounderContext } from '@/lib/command-center/guard'
import { northStar } from '@/lib/command-center/metrics'
import { compactMoney, num } from '@/components/command-center/ui'

export const dynamic = 'force-dynamic'

// Actuals — derived from VERIFIED sources (tenants, platform events, usage ledger). Metrics that can't yet
// be derived are shown as Manual (never faked). Where a forecast exists, we pair Actual vs Forecast vs
// Variance; deeper Forecast/Target coverage grows as actuals coverage grows.
export default async function CommandCenterActuals() {
  const asOf = new Date().toISOString()
  const founder = await getFounderContext()
  const { assumptions } = await loadActiveAssumptions(founder?.email ?? 'system')
  const metrics = await getActuals(asOf)
  const ns = northStar(runForecast(assumptions, 60), 11)
  const forecast: Record<string, number> = {
    customers: ns.customers, directCustomers: ns.directCustomers, affiliateCustomers: ns.affiliateCustomers, whiteLabelCustomers: ns.whiteLabelCustomers,
  }
  const fmt = (v: number | null, unit: 'count' | 'cents') => (v == null ? '—' : unit === 'cents' ? compactMoney(v) : num(v))

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Actuals</h2>
        <p className="text-sm text-subtle">Live figures from verified sources. Manual metrics await a real source — they are never estimated here.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-hairline-strong">
        <table className="min-w-full text-sm">
          <thead className="bg-sunken text-subtle">
            <tr>{['Metric', 'Actual', 'Source', 'Forecast (Base Yr1)', 'Variance'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {metrics.map((m) => {
              const fc = forecast[m.key]
              const variance = m.value != null && fc != null ? m.value - fc : null
              return (
                <tr key={m.key}>
                  <td className="px-3 py-2 font-medium text-ink">{m.label}</td>
                  <td className="px-3 py-2 tabular-nums">{m.value == null ? <span className="text-subtle">needs input</span> : fmt(m.value, m.unit)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${m.source === 'derived' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                      {m.source === 'derived' ? 'Actual' : 'Manual'}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-subtle">{fc != null ? fmt(fc, m.unit) : '—'}</td>
                  <td className={`px-3 py-2 tabular-nums ${variance == null ? 'text-subtle' : variance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{variance == null ? '—' : `${variance >= 0 ? '+' : ''}${fmt(variance, m.unit)}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
