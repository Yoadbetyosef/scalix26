import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getLifecycleOverview, CC_RELIABLE_FROM } from '@/lib/command-center/adapters'
import { compactMoney, num, Section } from '@/components/command-center/ui'
import { MetricStat, HealthPill } from '@/components/command-center/metric-ui'
import { ChurnCapture } from '@/components/command-center/churn-capture'

export const dynamic = 'force-dynamic'
const ENGINE_LABEL = { direct: 'Direct', affiliate: 'Affiliate', whiteLabel: 'White Label' } as const

// Retention — honest about history: rates are Derived-from-current-state (low confidence) until reliable
// billing-event history accrues from CC_RELIABLE_FROM. What IS actionable today: at-risk customers,
// revenue at risk, and manual churn-reason capture.
export default async function RetentionPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const o = await getLifecycleOverview()
  const boundaryReached = new Date().toISOString().slice(0, 10) >= CC_RELIABLE_FROM

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Retention</h2>
        <p className="text-sm text-subtle">Why are customers leaving or failing? Today: revenue at risk + churn-reason capture. Cohort churn/NRR trends need billing-event history.</p>
      </div>

      <div className={`mb-5 flex items-start gap-3 rounded-xl border-2 p-4 ${boundaryReached ? 'border-emerald-300 bg-emerald-50/50' : 'border-amber-300 bg-amber-50/60'}`}>
        <span className="text-xl leading-none">{boundaryReached ? '✅' : '⏳'}</span>
        <div>
          <div className="text-sm font-semibold text-ink">Event-sourced retention boundary: {CC_RELIABLE_FROM}</div>
          <div className="mt-0.5 text-xs text-subtle">
            {boundaryReached
              ? `Billing-event instrumentation is live. Churn, NRR, and cohort trends dated on/after ${CC_RELIABLE_FROM} are event-sourced. Anything earlier remains derived-from-current-state.`
              : `Billing-event instrumentation begins ${CC_RELIABLE_FROM}. Until then, every churn/NRR figure below is derived from current state (low confidence) or manually captured — none of it is event-sourced history yet.`}
          </div>
        </div>
      </div>

      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-700">Derived from current state</div>
      <p className="mb-2 text-xs text-subtle">Computed from today&apos;s customer state — actionable now, but not a churn time series.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <MetricStat label="Customers at risk" m={{ value: o.atRisk.length, source: 'derived_actual', coverage: 1, confidence: 'high', freshnessAt: o.freshnessAt }} format={(v) => num(v)} />
        <MetricStat label="Revenue at risk" m={o.revenueAtRiskCents} format={(v) => compactMoney(v)} />
        <MetricStat label="Critical accounts" m={{ value: o.healthDistribution.critical, source: 'derived_actual', coverage: 1, confidence: 'high', freshnessAt: o.freshnessAt }} format={(v) => num(v)} />
      </div>

      <div className="mt-5 mb-1 text-xs font-semibold uppercase tracking-wide text-violet-700">Event-sourced (needs history)</div>
      <p className="mb-2 text-xs text-subtle">Requires the billing-event stream. Populates from {CC_RELIABLE_FROM} onward.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <MetricStat label="Logo churn (trailing)" m={{ value: null, source: 'manual', coverage: 0, confidence: 'none', freshnessAt: null, reliableFrom: CC_RELIABLE_FROM, caveat: `Needs billing-event history — reliable from ${CC_RELIABLE_FROM}.` }} format={(v) => `${v}`} />
        <MetricStat label="Net revenue retention" m={{ value: null, source: 'manual', coverage: 0, confidence: 'none', freshnessAt: null, reliableFrom: CC_RELIABLE_FROM, caveat: `Needs billing-event history — reliable from ${CC_RELIABLE_FROM}.` }} format={(v) => `${v}`} />
        <MetricStat label="Gross revenue retention" m={{ value: null, source: 'manual', coverage: 0, confidence: 'none', freshnessAt: null, reliableFrom: CC_RELIABLE_FROM, caveat: `Needs billing-event history — reliable from ${CC_RELIABLE_FROM}.` }} format={(v) => `${v}`} />
      </div>

      <Section title="Cancellation-risk queue" subtitle="Health At Risk / Critical — highest MRR first.">
        {o.atRisk.length === 0 ? (
          <div className="rounded-xl border border-hairline-strong bg-white p-4 text-sm text-subtle">No at-risk customers.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline-strong">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-subtle"><tr>{['Customer', 'Tenant ID', 'Engine', 'Health', 'MRR at risk (est.)'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-hairline">
                {o.atRisk.slice(0, 25).map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-subtle">{r.id.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-subtle">{ENGINE_LABEL[r.engine]}</td>
                    <td className="px-3 py-2"><HealthPill bucket={r.bucket} /></td>
                    <td className="px-3 py-2 tabular-nums">{compactMoney(r.mrrCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="mt-6 mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">Manual capture</div>
      <Section title="Churn-reason capture" subtitle="Founder/admin manual classification (primary + notes + save attempt). Connects to a cancellation flow later.">
        <ChurnCapture />
      </Section>
    </div>
  )
}
