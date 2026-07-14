import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getFinance } from '@/lib/command-center/finance-adapter'
import { compactMoney, Section } from '@/components/command-center/ui'
import { MetricStat } from '@/components/command-center/metric-ui'

export const dynamic = 'force-dynamic'

// Revenue — reality first. Run-rate MRR by stream is Derived Actual (from real plans, not Stripe-collected).
// Actual collected revenue needs the Stripe/billing source and is Waiting for Data — list price is never
// shown as collected revenue.
export default async function RevenuePage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const f = await getFinance()

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Revenue</h2>
        <p className="text-sm text-subtle">Run-rate MRR from real customer plans (Derived Actual). Collected revenue requires the billing source — shown as Waiting for Data, never inferred from list price.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricStat label="Run-rate MRR" m={{ value: f.currentMrrCents, source: 'derived_actual', coverage: 1, confidence: 'high', freshnessAt: f.freshnessAt, caveat: 'Real plans × list price — not Stripe-collected.' }} format={(v) => compactMoney(v)} />
        <MetricStat label="Run-rate ARR" m={{ value: f.runRateArrCents, source: 'derived_actual', coverage: 1, confidence: 'high', freshnessAt: f.freshnessAt }} format={(v) => compactMoney(v)} />
        <MetricStat label="Collected revenue" m={{ value: null, source: 'manual', coverage: 0, confidence: 'none', freshnessAt: null, caveat: 'Needs Stripe/billing integration.' }} format={(v) => compactMoney(v)} />
        <MetricStat label="Paying customers" m={{ value: f.payingCustomers, source: 'derived_actual', coverage: 1, confidence: 'high', freshnessAt: f.freshnessAt }} format={(v) => `${v}`} />
      </div>

      <Section title="Revenue streams" subtitle="Separated by source. Waiting-for-Data streams are not yet instrumented.">
        <div className="overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle"><tr>{['Stream', 'Monthly', 'Annualized', 'Source'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              {f.streams.map((s) => (
                <tr key={s.key}>
                  <td className="px-3 py-2 text-ink">{s.label}</td>
                  <td className="px-3 py-2 tabular-nums">{s.source === 'waiting' ? <span className="text-subtle">Waiting for Data</span> : compactMoney(s.monthlyCents)}</td>
                  <td className="px-3 py-2 tabular-nums text-subtle">{s.source === 'waiting' ? '—' : compactMoney(s.monthlyCents * 12)}</td>
                  <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${s.source === 'derived_actual' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-500'}`}>{s.source === 'derived_actual' ? 'Derived Actual' : 'Waiting'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-subtle">Forecast revenue lives on the Forecast page; targets on Mission. This page is reality only.</p>
      </Section>
    </div>
  )
}
