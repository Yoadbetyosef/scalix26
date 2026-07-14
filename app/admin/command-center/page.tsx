import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getRealitySnapshot, getTrialConversion } from '@/lib/command-center/adapters'
import { getPlanNavigation } from '@/lib/command-center/plan-adapter'
import { compactMoney, pctText, num, Section } from '@/components/command-center/ui'
import { MetricStat, HealthPill } from '@/components/command-center/metric-ui'

const MONEY_METRICS = new Set(['arr_cents', 'mrr_cents', 'revenue', 'profit'])
const fmtGoal = (metric: string, v: number) => (MONEY_METRICS.has(metric) ? compactMoney(v) : `${Math.round(v).toLocaleString()} cust`)

export const dynamic = 'force-dynamic'
const ENGINE_LABEL = { direct: 'Direct', affiliate: 'Affiliate', whiteLabel: 'White Label' } as const

// Metrics we cannot yet source from ACTUAL data. The Overview shows reality only — so instead of
// substituting a forecast, we render "Waiting for Data" with what's needed and where projections live.
const WAITING: { label: string; needs: string }[] = [
  { label: 'Cash & Runway', needs: 'Connect a bank / finance source (actual cash balance & burn).' },
  { label: 'Net Profit / Burn', needs: 'Wire actual monthly costs (payroll, infra, COGS).' },
  { label: 'Gross Margin', needs: 'Needs actual revenue and cost of delivery.' },
  { label: 'CAC (blended)', needs: 'Wire actual acquisition spend per channel.' },
  { label: 'LTV', needs: 'Needs realized retention + margin history.' },
  { label: 'NRR / Churn', needs: 'Event-sourced from 2026-07-14 (billing events).' },
  { label: 'Valuation', needs: 'Simulation only — lives in Scenarios, never on the Overview.' },
]

function WaitingCard({ label, needs }: { label: string; needs: string }) {
  return (
    <div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">No source</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-subtle">Waiting for Data</div>
      <div className="mt-1 text-[11px] leading-tight text-subtle">{needs}</div>
    </div>
  )
}

// Home / Overview — a MIRROR OF REALITY. Only Actual and Derived-Actual metrics from live customer and
// subscription data appear here. Forecasts, targets, and scenario outputs are structurally excluded:
// forecasts live on the Forecast page, targets on Mission, simulations on Scenarios. Reality always wins —
// where there is no actual source, we show "Waiting for Data", never an assumption.
export default async function CommandCenterOverview() {
  // Self-guard: RSC renders the page body before the layout's gate.
  const founder = await getFounderContext()
  if (!founder) notFound()

  const [r, tc, nav] = await Promise.all([getRealitySnapshot(), getTrialConversion(), getPlanNavigation()])
  const y = nav.cascade.year, behind = y.behindPct

  return (
    <div>
      {/* Plan card — Goal → Reality → Gap → Today, one glance. */}
      <div className="mb-4 rounded-2xl border border-hairline-strong bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-ink">My Plan</span>
          <span className={`text-xs font-semibold ${behind > 0.05 ? 'text-red-600' : behind < -0.05 ? 'text-emerald-600' : 'text-subtle'}`}>{y.status === 'no_data' ? 'set a target date' : behind > 0.05 ? `${behind.toFixed(1)}% behind` : behind < -0.05 ? `${(-behind).toFixed(1)}% ahead` : 'on plan'}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><div className="text-[10px] uppercase text-subtle">Goal</div><div className="text-base font-bold text-ink">{fmtGoal(nav.config.primaryMetric, y.target)}</div></div>
          <div><div className="text-[10px] uppercase text-subtle">Current</div><div className="text-base font-bold text-ink">{fmtGoal(nav.config.primaryMetric, y.current)}</div></div>
          <div><div className="text-[10px] uppercase text-subtle">Gap</div><div className="text-base font-bold text-ink">{fmtGoal(nav.config.primaryMetric, y.gap)}</div></div>
          <div><div className="text-[10px] uppercase text-subtle">Progress</div><div className="text-base font-bold text-ink">{(y.progressPct * 100).toFixed(1)}%</div></div>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-subtle sm:grid-cols-3">
          <div>This Month: <span className="text-ink">{nav.cascade.month.actual}/{nav.cascade.month.requirement}</span> · {nav.cascade.month.remaining} left</div>
          <div>This Week: <span className="text-ink">{nav.cascade.week.actual}/{nav.cascade.week.requirement}</span> · {nav.cascade.week.remaining} left</div>
          <div>Today: <span className="text-ink">{nav.cascade.today.length}</span> priority action{nav.cascade.today.length === 1 ? '' : 's'}</div>
        </div>
        {nav.cascade.today.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-ink">{nav.cascade.today.slice(0, 3).map((a) => <li key={a.key}>{a.action}</li>)}</ul>}
        <Link href="/admin/command-center/plan" className="mt-3 inline-block rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">Open Plan</Link>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
        <span className="font-semibold">Reality only.</span> Every number below is Actual or Derived-Actual from live product &amp; customer data.
        Forecasts live on <span className="font-medium">Forecast</span>, targets on <span className="font-medium">Mission</span>, simulations on <span className="font-medium">Scenarios</span> — never here.
      </div>

      <Section title="Business reality" subtitle="Current run-rate from real customers &amp; subscriptions — not a projection.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricStat label="Current MRR" m={r.currentMrrCents} format={(v) => compactMoney(v)} />
          <MetricStat label="Run-rate ARR" m={r.runRateArrCents} format={(v) => compactMoney(v)} />
          <MetricStat label="Paying customers" m={r.payingCustomers} format={(v) => num(v)} />
          <MetricStat label="ARPU" m={r.arpuCents} format={(v) => compactMoney(v)} />
          <MetricStat label="Active trials" m={r.activeTrials} format={(v) => num(v)} />
          <MetricStat label="Trial → Paid" m={r.trialConversionRate} format={(v) => pctText(v)} />
          <MetricStat label="Activation" m={r.activationRate} format={(v) => pctText(v)} />
          <MetricStat label="Total customers" m={r.totalCustomers} format={(v) => num(v)} />
        </div>
        {r.payingCustomers.value === 0 && (
          <p className="mt-2 text-xs text-amber-700">Pre-revenue: no paying customers yet, so MRR/ARR/ARPU are real zeros — the live bottleneck is trial→paid conversion.</p>
        )}
      </Section>

      <Section title="Growth engines (live)" subtitle="Real customers &amp; MRR per engine — Derived Actual, not forecast contribution.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {r.byEngine.map((e) => (
            <div key={e.engine} className="rounded-xl border border-hairline-strong bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-subtle">{ENGINE_LABEL[e.engine]}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{compactMoney(e.mrrCents)}</div>
              <div className="mt-0.5 text-xs text-subtle">{num(e.paying)} paying · {num(e.activeTrials)} active trials · {num(e.total)} total</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Needs attention (live)" subtitle="Derived from real customer state — the actual risks right now.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricStat label="Revenue at risk" m={r.revenueAtRiskCents} format={(v) => compactMoney(v)} />
          <MetricStat label="Activated, not paid" m={{ value: tc.activatedNotPaid, source: 'derived_actual', coverage: 1, confidence: 'high', freshnessAt: r.freshnessAt, caveat: 'Trials that reached product value — warmest conversion targets.' }} format={(v) => num(v)} />
          <MetricStat label="Critical accounts" m={{ value: r.healthDistribution.critical, source: 'derived_actual', coverage: 1, confidence: 'high', freshnessAt: r.freshnessAt }} format={(v) => num(v)} />
          <MetricStat label="At-risk accounts" m={{ value: r.atRisk.length, source: 'derived_actual', coverage: 1, confidence: 'high', freshnessAt: r.freshnessAt }} format={(v) => num(v)} />
        </div>
        {r.atRisk.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-hairline-strong">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-subtle"><tr>{['Customer', 'Engine', 'Health', 'MRR (est.)'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-hairline">
                {r.atRisk.slice(0, 10).map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-medium text-ink">{a.name}</td>
                    <td className="px-3 py-2 text-subtle">{ENGINE_LABEL[a.engine]}</td>
                    <td className="px-3 py-2"><HealthPill bucket={a.bucket} /></td>
                    <td className="px-3 py-2 tabular-nums">{compactMoney(a.mrrCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Waiting for data" subtitle="Not yet sourced from actuals. We leave these empty on purpose — the Overview never fills a gap with an assumption.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {WAITING.map((w) => <WaitingCard key={w.label} {...w} />)}
        </div>
      </Section>
    </div>
  )
}
