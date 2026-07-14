import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { loadActiveAssumptions } from '@/lib/command-center/active'
import { runForecast } from '@/lib/command-center/engine'
import { compactMoney, num, Section } from '@/components/command-center/ui'
import { ForecastTable } from '@/components/command-center/forecast-table'

export const dynamic = 'force-dynamic'

// Forecast — assumption-based projection ONLY. Every value is a Forecast (labeled). It never appears on the
// Overview as reality. Runs the persisted operating-model assumptions through the deterministic engine.
export default async function ForecastPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const { assumptions, persisted } = await loadActiveAssumptions(founder.email)
  const f = runForecast(assumptions, 60)
  // Annual rollup (year-end month = 12, 24, 36, 48, 60).
  const years = [12, 24, 36, 48, 60].map((mo) => f.months[mo - 1]).filter(Boolean)

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Forecast</h2>
        <p className="text-sm text-subtle">Projection only — {persisted ? 'persisted operating-model assumptions' : 'seed defaults (persist via Settings)'} run through the deterministic engine. All values are <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-700">Forecast</span>, never shown as reality on the Overview.</p>
      </div>

      <Section title="Annual rollup" subtitle="Year-end snapshots (months 12 · 24 · 36 · 48 · 60).">
        <div className="overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle"><tr>{['Year', 'Customers', 'ARR', 'Gross margin', 'Operating profit', 'Ending cash', 'Valuation'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              {years.map((m, i) => (
                <tr key={m.month}>
                  <td className="px-3 py-2 font-medium text-ink">Y{i + 1}</td>
                  <td className="px-3 py-2 tabular-nums">{num(m.endCustomers)}</td>
                  <td className="px-3 py-2 tabular-nums">{compactMoney(m.arrCents)}</td>
                  <td className="px-3 py-2 tabular-nums">{(m.grossMargin * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2 tabular-nums">{compactMoney(m.operatingProfitCents)}</td>
                  <td className="px-3 py-2 tabular-nums">{compactMoney(m.endingCashCents)}</td>
                  <td className="px-3 py-2 tabular-nums">{compactMoney(m.valuationCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="60-month forecast" subtitle="Expand/collapse row groups; export CSV; scroll horizontally.">
        <ForecastTable months={f.months} />
      </Section>
    </div>
  )
}
