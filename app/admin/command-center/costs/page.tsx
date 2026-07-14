import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getFinance } from '@/lib/command-center/finance-adapter'
import { compactMoney, Section } from '@/components/command-center/ui'
import { CostEditor } from '@/components/command-center/cost-editor'

export const dynamic = 'force-dynamic'

// Costs — actual/manual costs (this page) are kept separate from forecast costs (Forecast page). Monthly
// run-rate normalizes recurrence; one-time costs are tracked but excluded from the recurring run-rate.
export default async function CostsPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const f = await getFinance()
  const c = f.costs

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Costs</h2>
        <p className="text-sm text-subtle">Actual / manual costs (COGS + OpEx). Entering costs unlocks real gross margin and cost-to-serve on Unit Economics. Forecast costs are modeled separately on Forecast.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">Monthly COGS</div><div className="text-xl font-bold text-ink">{compactMoney(c.monthlyCogsCents)}</div></div>
        <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">Monthly OpEx</div><div className="text-xl font-bold text-ink">{compactMoney(c.monthlyOpexCents)}</div></div>
        <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">Total monthly</div><div className="text-xl font-bold text-ink">{compactMoney(c.monthlyTotalCents)}</div></div>
        <div className="rounded-xl border border-hairline-strong bg-white p-3"><div className="text-[11px] uppercase text-subtle">One-time (active)</div><div className="text-xl font-bold text-ink">{compactMoney(c.oneTimeActiveCents)}</div></div>
      </div>

      {c.byCategory.length > 0 && (
        <Section title="By category (monthly run-rate)" subtitle="Largest first.">
          <div className="overflow-x-auto rounded-xl border border-hairline-strong">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-subtle"><tr>{['Type', 'Category', 'Monthly'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-hairline">
                {c.byCategory.map((x) => <tr key={x.costType + x.category}><td className="px-3 py-2 uppercase text-subtle">{x.costType}</td><td className="px-3 py-2 capitalize text-ink">{x.category.replace(/_/g, ' ')}</td><td className="px-3 py-2 tabular-nums">{compactMoney(x.monthlyCents)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Cost items" subtitle="Add, edit, remove. Every change is audited.">
        <CostEditor items={f.costItems} />
      </Section>
    </div>
  )
}
