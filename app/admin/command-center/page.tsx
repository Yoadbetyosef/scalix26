import { notFound } from 'next/navigation'
import { runForecast } from '@/lib/command-center/engine'
import { loadActiveAssumptions } from '@/lib/command-center/active'
import { getFounderContext } from '@/lib/command-center/guard'
import { northStar } from '@/lib/command-center/metrics'
import { assembleEngines } from '@/lib/command-center/engines'
import { computePriorities } from '@/lib/command-center/priorities'
import { buildCeoBrief } from '@/lib/command-center/brief'
import { playbookFor } from '@/lib/command-center/playbooks'
import { capacityPlan } from '@/lib/command-center/capacity'
import { compactMoney, pctText, num, KpiCard, EngineCard, Section } from '@/components/command-center/ui'

export const dynamic = 'force-dynamic'

const PRIORITY_TONE = { critical: 'bg-red-100 text-red-700', high: 'bg-amber-100 text-amber-700', medium: 'bg-sky-100 text-sky-700', low: 'bg-gray-100 text-gray-600' } as const
const HEADLINE_MONTH = 12 // Year-1 snapshot of the Base forecast

function Question({ q, a }: { q: string; a: string }) {
  return <div><div className="text-xs font-semibold uppercase tracking-wide text-subtle">{q}</div><div className="mt-0.5 text-sm text-ink">{a}</div></div>
}

// Home / Overview — the CEO operating system. Every section drives a decision: the CEO Brief answers the
// four questions, Priorities rank the biggest problems with $ impact + a recommended action + a playbook,
// and each engine card links to its playbook. Phase 1/2 render the BASE forecast (persisted scenarios +
// live actuals arrive in Phase 2b), clearly labeled as a forecast — never mixed with booked results.
export default async function CommandCenterOverview() {
  // Self-guard: RSC renders the page body before the layout's gate, so guard here too — otherwise a
  // non-founder (who still gets a 404 from the layout) would trigger config creation as a side effect.
  const founder = await getFounderContext()
  if (!founder) notFound()
  const { assumptions, persisted } = await loadActiveAssumptions(founder.email)
  const forecast = runForecast(assumptions, 60)
  const idx = HEADLINE_MONTH - 1
  const brief = buildCeoBrief(forecast, idx)
  const ns = northStar(forecast, idx)
  const engines = assembleEngines(forecast, idx)
  const priorities = computePriorities(forecast, idx)
  const capacity = capacityPlan(ns.customers).filter((c) => c.required > 0 || c.nextHireAtCustomers <= ns.customers * 3)
  const runwayText = ns.runwayMonths === null ? 'Profitable' : `${ns.runwayMonths.toFixed(1)} mo`

  return (
    <div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
        {persisted
          ? `Persisted operating model · Month ${HEADLINE_MONTH} (Year 1) forecast. Live actuals integrate next — figures here are a forecast, not booked results.`
          : '⚠ Persistence unavailable — showing seed defaults. Run the Command Center migrations to persist and edit assumptions.'}
      </div>

      {/* CEO Brief — the four questions every screen must answer. */}
      <div className="mt-4 grid gap-4 rounded-xl border border-hairline-strong bg-white p-5 md:grid-cols-2">
        <Question q="Where are we?" a={brief.whereAreWe} />
        <Question q="Where are we going?" a={brief.whereGoing} />
        <Question q="What is stopping us?" a={brief.whatStopping} />
        <Question q="What should I do next?" a={brief.whatNext} />
      </div>

      <Section title="North Star" subtitle="Are we winning?">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="MRR" value={compactMoney(ns.mrrCents)} sub={`${pctText(ns.monthlyGrowthPct, 1)} MoM`} />
          <KpiCard label="ARR" value={compactMoney(ns.arrCents)} sub={`Target ${compactMoney(ns.targetArrCents)}`} />
          <KpiCard label="Gap to Target ARR" value={compactMoney(ns.arrGapCents)} />
          <KpiCard label="Customers" value={num(ns.customers)} sub={`${num(ns.directCustomers)} direct · ${num(ns.affiliateCustomers)} affiliate · ${num(ns.whiteLabelCustomers)} WL`} />
          <KpiCard label="Valuation (sim.)" value={compactMoney(ns.valuationCents)} sub={`Target ${compactMoney(ns.targetValuationCents)}`} />
          <KpiCard label="Progress to $1B" value={pctText(ns.progressToTargetPct, 2)} tone="text-emerald-600" />
          <KpiCard label="Cash" value={compactMoney(ns.cashCents)} />
          <KpiCard label="Runway" value={runwayText} tone={ns.runwayMonths !== null && ns.runwayMonths < 6 ? 'text-red-600' : 'text-ink'} />
          <KpiCard label="Net Profit / mo" value={compactMoney(ns.netProfitCents)} tone={ns.netProfitCents < 0 ? 'text-red-600' : 'text-emerald-600'} />
          <KpiCard label="Gross Margin" value={pctText(ns.grossMargin)} />
          <KpiCard label="ARPU" value={compactMoney(ns.arpuCents)} />
          <KpiCard label="NRR" value={pctText(ns.nrr)} />
          <KpiCard label="LTV" value={compactMoney(ns.ltvCents)} />
          <KpiCard label="CAC (blended)" value={compactMoney(ns.cacCents)} />
          <KpiCard label="Expansion %" value={pctText(ns.expansionPct)} />
          <KpiCard label="Payback" value={forecast.months[idx].cacPaybackMonths === null ? '—' : `${forecast.months[idx].cacPaybackMonths!.toFixed(1)} mo`} />
        </div>
      </Section>

      <Section title="Growth Engines" subtitle="Four independent engines — output, contribution, health and the playbook to fix each.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {engines.map((e) => {
            const pb = playbookFor(e.playbookKey)
            return (
              <EngineCard key={e.key} label={e.label} health={e.health}
                primary={compactMoney(e.currentMrrCents)}
                secondary={e.key === 'expansion' ? 'expansion MRR' : `${num(e.customers)} customers · +${num(e.addsPerMonth)}/mo`}
                contributionPct={e.contributionPct} trend={e.trend}
                action={pb ? <span className="text-subtle">Open <span className="font-medium text-ink">{pb.title}</span> <span className="rounded bg-sunken px-1 text-[10px]">soon</span></span> : null} />
            )
          })}
        </div>
      </Section>

      <Section title="CEO Priorities" subtitle="The biggest problems right now — ranked, with estimated impact and the next action.">
        {priorities.length === 0 ? (
          <div className="rounded-xl border border-hairline-strong bg-white p-4 text-sm text-subtle">No priorities flagged at this snapshot.</div>
        ) : (
          <div className="space-y-3">
            {priorities.slice(0, 5).map((p, i) => (
              <div key={p.id} className="rounded-xl border border-hairline-strong bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-subtle">#{i + 1}</span>
                  <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${PRIORITY_TONE[p.priority]}`}>{p.priority}</span>
                  <span className="font-semibold text-ink">{p.title}</span>
                  {p.estimatedArrImpactCents > 0 && <span className="ml-auto text-sm font-semibold text-red-600">−{compactMoney(p.estimatedArrImpactCents)} ARR</span>}
                </div>
                <div className="mt-1 text-sm text-subtle">{p.detail}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-ink">→ {p.recommendedAction}</span>
                  {playbookFor(p.playbookKey) && <span className="text-subtle">· {playbookFor(p.playbookKey)!.title} <span className="rounded bg-sunken px-1 text-[10px]">soon</span></span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Capacity Planner" subtitle={`Staffing needs at ~${num(ns.customers)} customers.`}>
        <div className="overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle">
              <tr>{['Role', 'Department', 'Required now', 'Next hire at'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {capacity.map((c) => (
                <tr key={c.role}>
                  <td className="px-3 py-2 font-medium text-ink">{c.role}</td>
                  <td className="px-3 py-2 text-subtle">{c.department}</td>
                  <td className="px-3 py-2 tabular-nums">{c.required}</td>
                  <td className="px-3 py-2 tabular-nums text-subtle">{num(c.nextHireAtCustomers)} customers</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
