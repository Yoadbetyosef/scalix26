import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { loadActiveAssumptions } from '@/lib/command-center/active'
import { runForecast } from '@/lib/command-center/engine'
import { applyDecisions, type Decision } from '@/lib/command-center/mission'
import { timeToTargetMonths } from '@/lib/command-center/metrics'
import { compactMoney, num, Section } from '@/components/command-center/ui'
import { MissionPlanner } from '@/components/command-center/mission-planner'

export const dynamic = 'force-dynamic'
const HORIZON = 24 // 2-year comparison point

const PRESETS: { name: string; decisions: Decision[]; note: string }[] = [
  { name: 'Conservative', decisions: [{ kind: 'setMonthlyChurn', rate: 0.05 }], note: 'Higher churn (5%/mo)' },
  { name: 'Base', decisions: [], note: 'Persisted assumptions' },
  { name: 'Aggressive', decisions: [{ kind: 'increasePricingPct', pct: 0.10 }, { kind: 'addMarketingBudgetCents', cents: 500000 }], note: '+10% price, +$5k/mo marketing' },
]

// Scenarios — what-if SIMULATIONS only. Each preset applies decision deltas to the base assumptions and is
// compared at a 2-year horizon. Clearly labeled Simulation; never shown as reality on the Overview.
export default async function ScenariosPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const { assumptions } = await loadActiveAssumptions(founder.email)
  const target = assumptions.targets.targetArrCents
  const rows = PRESETS.map((p) => {
    const f = runForecast(applyDecisions(assumptions, p.decisions), 60)
    const m = f.months[HORIZON - 1]
    return { name: p.name, note: p.note, m, ttt: timeToTargetMonths(f, target) }
  })

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Scenarios</h2>
        <p className="text-sm text-subtle">What-if simulations — compared at month {HORIZON}. Every figure is a <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-700">Simulation</span>, never reality. Edit the Base via Settings.</p>
      </div>

      <Section title={`Scenario comparison (@ month ${HORIZON})`} subtitle="Conservative · Base · Aggressive from the same assumptions.">
        <div className="overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle"><tr>{['Scenario', 'Customers', 'MRR', 'ARR', 'Gross margin', 'Op. profit', 'Cash', 'Runway', 'Valuation', 'Time to target'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="px-3 py-2 font-medium text-ink whitespace-nowrap">{r.name}<div className="text-[10px] text-subtle">{r.note}</div></td>
                  <td className="px-3 py-2 tabular-nums">{num(r.m.endCustomers)}</td>
                  <td className="px-3 py-2 tabular-nums">{compactMoney(r.m.grossMrrCents)}</td>
                  <td className="px-3 py-2 tabular-nums">{compactMoney(r.m.arrCents)}</td>
                  <td className="px-3 py-2 tabular-nums">{(r.m.grossMargin * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2 tabular-nums">{compactMoney(r.m.operatingProfitCents)}</td>
                  <td className="px-3 py-2 tabular-nums">{compactMoney(r.m.endingCashCents)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.m.runwayMonths == null ? 'Profitable' : `${r.m.runwayMonths.toFixed(0)}mo`}</td>
                  <td className="px-3 py-2 tabular-nums">{compactMoney(r.m.valuationCents)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.ttt == null ? '—' : `${r.ttt}mo`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Mission Planner" subtitle="Interactive what-if: apply decisions and see the before/after effect on the whole company.">
        <MissionPlanner />
      </Section>
    </div>
  )
}
