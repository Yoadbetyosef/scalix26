import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getGrowthEngines } from '@/lib/command-center/growth-adapter'
import { compactMoney, num, Section } from '@/components/command-center/ui'

export const dynamic = 'force-dynamic'

// Growth Engines — the four engines with REALITY current output, targets and required activity. Funnel steps
// that aren't instrumented yet show "Waiting for Data" rather than a fabricated number. Required activity is
// a labeled Estimate. Expansion opportunities are derived from real usage; no offers are auto-sent.
export default async function GrowthEnginesPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const g = await getGrowthEngines()

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Growth Engines</h2>
        <p className="text-sm text-subtle">Four engines, one honest scoreboard: current output is reality; required activity is an Estimate; un-instrumented funnel steps are flagged Waiting for Data.</p>
      </div>

      {g.engines.map((e) => (
        <Section key={e.key} title={e.label} subtitle={e.mission}>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">Paying {e.key === 'expansion' ? '(eligible)' : ''}</div><div className="text-xl font-bold text-ink">{num(e.currentCustomers)}</div><span className="rounded bg-sky-100 px-1 text-[9px] text-sky-700">Derived Actual</span></div>
            <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">MRR</div><div className="text-xl font-bold text-ink">{compactMoney(e.currentMrrCents)}</div><span className="rounded bg-sky-100 px-1 text-[9px] text-sky-700">Derived Actual</span></div>
            <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">Active trials</div><div className="text-xl font-bold text-ink">{num(e.activeTrials)}</div></div>
            <div className="rounded-xl border border-dashed border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">Required / mo</div><div className="text-xl font-bold text-ink">{e.required.requiredMonthly == null ? '—' : `+${num(e.required.requiredMonthly)}`}</div><span className="rounded bg-orange-100 px-1 text-[9px] text-orange-700">{e.required.targetCustomers == null ? 'set target in Mission' : 'Estimate'}</span></div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-hairline-strong">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-subtle"><tr>{['Funnel step', 'Value', 'Source'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-hairline">
                {e.funnel.map((s) => (
                  <tr key={s.key}>
                    <td className="px-3 py-2 text-ink">{s.label}</td>
                    <td className="px-3 py-2 tabular-nums">{s.value == null ? <span className="text-subtle">Waiting for Data</span> : (s.key === 'mrr' || s.key === 'expansion_mrr' ? compactMoney(s.value * 100) : num(s.value))}</td>
                    <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${s.source === 'derived_actual' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-500'}`}>{s.source === 'derived_actual' ? 'Derived Actual' : 'Waiting'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-amber-700">Bottleneck: {e.bottleneckHint}</p>
        </Section>
      ))}

      <Section title="Expansion opportunities" subtitle="Deterministic groups from real usage. No customer is auto-contacted.">
        {g.expansion.length === 0 ? (
          <div className="rounded-xl border border-hairline-strong bg-white p-4 text-sm text-subtle">No expansion opportunity groups at current usage.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-hairline-strong">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-subtle"><tr>{['Group', 'Customers', 'Potential MRR', 'Confidence', 'Recommended campaign'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-hairline">
                {g.expansion.map((grp) => (
                  <tr key={grp.key}>
                    <td className="px-3 py-2 font-medium text-ink">{grp.label}</td>
                    <td className="px-3 py-2 tabular-nums">{num(grp.count)}</td>
                    <td className="px-3 py-2 tabular-nums">{grp.potentialMrrCents > 0 ? compactMoney(grp.potentialMrrCents) : '—'}</td>
                    <td className="px-3 py-2 capitalize text-subtle">{grp.confidence}</td>
                    <td className="px-3 py-2 text-subtle">{grp.recommendedCampaign}</td>
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
