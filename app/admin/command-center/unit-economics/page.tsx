import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getFinance } from '@/lib/command-center/finance-adapter'
import { compactMoney, pctText, Section } from '@/components/command-center/ui'
import { MetricStat } from '@/components/command-center/metric-ui'

export const dynamic = 'force-dynamic'

function Waiting({ label, needs }: { label: string; needs: string }) {
  return <div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 p-4"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</span><span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">No source</span></div><div className="mt-1 text-lg font-semibold text-subtle">Waiting for Data</div><div className="mt-1 text-[11px] text-subtle">{needs}</div></div>
}

// Unit Economics — reality where computable (ARPU, revenue per engine), gross margin/cost-to-serve once actual
// costs exist, and Waiting for Data for CAC/LTV/payback/churn/NRR/GRR (need acquisition spend + event history).
export default async function UnitEconomicsPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const f = await getFinance()
  const u = f.unitEcon
  const hasCosts = f.costItems.length > 0

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Unit Economics</h2>
        <p className="text-sm text-subtle">Canonical formulas on real data. Gross margin needs actual costs (enter them on Costs); CAC/LTV/churn need acquisition spend and event-sourced retention — shown honestly as Waiting for Data.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricStat label="ARPU" m={{ value: u.arpuCents, source: 'derived_actual', coverage: 1, confidence: 'high', freshnessAt: f.freshnessAt }} format={(v) => compactMoney(v)} />
        <MetricStat label="Gross margin" m={{ value: u.grossMarginPct, source: hasCosts ? 'derived_actual' : 'manual', coverage: hasCosts ? 1 : 0, confidence: hasCosts ? 'high' : 'none', freshnessAt: f.freshnessAt, caveat: hasCosts ? '(MRR − COGS) ÷ MRR' : 'Enter actual COGS on Costs.' }} format={(v) => pctText(v)} />
        <MetricStat label="Cost to serve / cust" m={{ value: u.costToServeCents, source: hasCosts ? 'derived_actual' : 'manual', coverage: hasCosts ? 1 : 0, confidence: hasCosts ? 'high' : 'none', freshnessAt: f.freshnessAt, caveat: hasCosts ? undefined : 'Enter actual COGS on Costs.' }} format={(v) => compactMoney(v)} />
        <MetricStat label="Contribution / cust" m={{ value: u.contributionPerCustomerCents, source: hasCosts ? 'derived_actual' : 'manual', coverage: hasCosts ? 1 : 0, confidence: hasCosts ? 'high' : 'none', freshnessAt: f.freshnessAt }} format={(v) => compactMoney(v)} />
      </div>

      <Section title="Waiting for data" subtitle="Needs sources we don't have yet — never estimated as reality.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Waiting label="CAC (blended + by engine)" needs="Needs actual acquisition spend per channel (enter marketing costs)." />
          <Waiting label="LTV" needs="Needs realized retention + margin history." />
          <Waiting label="CAC payback" needs="Needs CAC + contribution margin." />
          <Waiting label="Logo churn / GRR / NRR" needs="Event-sourced from 2026-07-14 (billing events)." />
          <Waiting label="Margin per plan / engine" needs="Needs cost allocation per segment." />
          <Waiting label="Negative-margin flags" needs="Needs per-customer cost to serve." />
        </div>
      </Section>

      <Section title="Revenue by engine (Derived Actual)" subtitle="ARPU and revenue share per engine from real customers.">
        <div className="overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle"><tr>{['Engine', 'Customers', 'MRR', 'ARPU', 'Revenue share'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              {f.segments.map((s) => (
                <tr key={s.key}>
                  <td className="px-3 py-2 text-ink">{s.label}</td>
                  <td className="px-3 py-2 tabular-nums">{s.customers}</td>
                  <td className="px-3 py-2 tabular-nums">{compactMoney(s.mrrCents)}</td>
                  <td className="px-3 py-2 tabular-nums">{s.arpuCents == null ? '—' : compactMoney(s.arpuCents)}</td>
                  <td className="px-3 py-2 tabular-nums text-subtle">{pctText(s.sharePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
