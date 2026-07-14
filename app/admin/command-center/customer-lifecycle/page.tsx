import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getLifecycleOverview, getTrialConversion, CC_RELIABLE_FROM } from '@/lib/command-center/adapters'
import { compactMoney, num, pctText, Section } from '@/components/command-center/ui'
import { MetricStat, HealthPill } from '@/components/command-center/metric-ui'
import { metric } from '@/lib/command-center/sources'

export const dynamic = 'force-dynamic'
const ENGINE_LABEL = { direct: 'Direct', affiliate: 'Affiliate', whiteLabel: 'White Label' } as const

export default async function CustomerLifecycle() {
  const founder = await getFounderContext()
  if (!founder) notFound() // self-guard before any DB read
  const [o, tc] = await Promise.all([getLifecycleOverview(), getTrialConversion()])

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Customer Lifecycle</h2>
        <p className="text-sm text-subtle">Are customers becoming successful? Derived from real product behavior; internal/test/free tenants excluded. Event-sourced history begins {CC_RELIABLE_FROM}.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricStat label="Customers" m={o.totalCustomers} format={(v) => num(v)} />
        <MetricStat label="Activation rate" m={o.activationRate} format={(v) => pctText(v)} />
        <MetricStat label="Adoption rate" m={o.adoptionRate} format={(v) => pctText(v)} />
        <MetricStat label="Revenue at risk" m={o.revenueAtRiskCents} format={(v) => compactMoney(v)} />
      </div>

      <Section title="Trial → Paid conversion" subtitle={`${num(tc.activeTrials)} of ${num(tc.started)} customers are still on trial — converting them, not preventing churn, is the current bottleneck.`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricStat label="Active trials" m={metric(tc.activeTrials, 'derived_actual', { freshnessAt: o.freshnessAt })} format={(v) => num(v)} />
          <MetricStat label="Converted to paid" m={metric(tc.converted, 'derived_actual', { freshnessAt: o.freshnessAt })} format={(v) => num(v)} />
          <MetricStat label="Conversion rate" m={metric(tc.conversionRate, 'derived_actual', { freshnessAt: o.freshnessAt, caveat: `From current subscription state. Cohort/time-to-paid needs conversion timestamps — event history reliable from ${CC_RELIABLE_FROM}.` })} format={(v) => pctText(v)} />
          <MetricStat label="Trial MRR opportunity" m={metric(tc.trialMrrOpportunityCents, 'estimate', { caveat: 'Active trials × standard plan price — potential MRR if every active trial converted.' })} format={(v) => compactMoney(v)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricStat label="Activated, not paid" m={metric(tc.activatedNotPaid, 'derived_actual', { freshnessAt: o.freshnessAt, caveat: 'Reached product value but still on trial — warmest conversion targets.' })} format={(v) => num(v)} />
          <MetricStat label="Adopted, not paid" m={metric(tc.adoptedNotPaid, 'derived_actual', { freshnessAt: o.freshnessAt, caveat: 'Actively using the product but not yet paying.' })} format={(v) => num(v)} />
          <MetricStat label="Expired trials" m={metric(tc.expired, 'derived_actual', { freshnessAt: o.freshnessAt })} format={(v) => num(v)} />
        </div>
        <div className="mt-3 overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle"><tr>{['Engine', 'Started', 'Converted', 'Conversion rate'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              {(['direct', 'affiliate', 'whiteLabel'] as const).map((e) => (
                <tr key={e}>
                  <td className="px-3 py-2 font-medium text-ink">{ENGINE_LABEL[e]}</td>
                  <td className="px-3 py-2 tabular-nums">{num(tc.byEngine[e].started)}</td>
                  <td className="px-3 py-2 tabular-nums">{num(tc.byEngine[e].converted)}</td>
                  <td className="px-3 py-2 tabular-nums">{pctText(tc.byEngine[e].conversionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Customer health" subtitle="Lifecycle-aware — new customers in grace are not marked at-risk for low usage.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(['healthy', 'watch', 'at_risk', 'critical'] as const).map((b) => (
            <div key={b} className="rounded-xl border border-hairline-strong bg-white p-4">
              <div className="text-2xl font-bold tabular-nums text-ink">{o.healthDistribution[b]}</div>
              <HealthPill bucket={b} />
            </div>
          ))}
        </div>
        <div className="mt-2 text-xs text-subtle">By engine: {ENGINE_LABEL.direct} {o.byEngine.direct} · {ENGINE_LABEL.affiliate} {o.byEngine.affiliate} · {ENGINE_LABEL.whiteLabel} {o.byEngine.whiteLabel}</div>
      </Section>

      <Section title="At-risk customers" subtitle="Health At Risk or Critical — intervene first where MRR is highest.">
        {o.atRisk.length === 0 ? (
          <div className="rounded-xl border border-hairline-strong bg-white p-4 text-sm text-subtle">No at-risk customers.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline-strong">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-subtle"><tr>{['Customer', 'Engine', 'Health', 'MRR (est.)'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-hairline">
                {o.atRisk.slice(0, 25).map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
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
    </div>
  )
}
