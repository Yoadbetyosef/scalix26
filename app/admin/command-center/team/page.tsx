import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getTeamCapacity } from '@/lib/command-center/ops-adapters'
import { compactMoney, num, Section } from '@/components/command-center/ui'
import { TeamRoster } from '@/components/command-center/team-roster'

export const dynamic = 'force-dynamic'

const DRIVER_ROWS: { key: 'support_hours' | 'onboarding_accounts' | 'cs_customers' | 'producing_agencies' | 'active_affiliates' | 'sales_opportunities'; label: string; fmt?: (v: number) => string }[] = [
  { key: 'support_hours', label: 'Support demand hours', fmt: (v) => `${v.toFixed(1)}h` },
  { key: 'onboarding_accounts', label: 'Accounts in onboarding' },
  { key: 'cs_customers', label: 'Activated customers' },
  { key: 'producing_agencies', label: 'Active agencies' },
  { key: 'active_affiliates', label: 'Active affiliates' },
  { key: 'sales_opportunities', label: 'Sales opportunities' },
]

// Team & Capacity V2 — workload-based planning. Capacity is measured against REAL demand drivers (support
// hours, onboarding accounts, activated customers, agencies, affiliates), never raw customer count. A hire is
// only recommended when a real driver exceeds target-utilization capacity.
export default async function TeamPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const t = await getTeamCapacity()
  const d = t.distribution

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Team &amp; Capacity</h2>
        <p className="text-sm text-subtle">Workload-based capacity planning. Demand comes from live operations; hires are recommended only from real capacity gaps — never from customer count alone.</p>
      </div>

      <Section title="Capacity health" subtitle={`${num(t.workloads.length)} roles · ${compactMoney(t.totalFullyLoadedMonthlyCents)}/mo fully loaded · ${num(t.recommendedHires.length)} hire(s) recommended`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {([['under', 'Under capacity', 'text-sky-600'], ['healthy', 'Healthy', 'text-emerald-600'], ['near', 'Near capacity', 'text-amber-600'], ['overloaded', 'Overloaded', 'text-red-600'], ['unknown', 'No demand data', 'text-subtle']] as const).map(([k, label, tone]) => (
            <div key={k} className="rounded-xl border border-hairline-strong bg-white p-4">
              <div className={`text-2xl font-bold tabular-nums ${tone}`}>{d[k]}</div>
              <div className="text-xs text-subtle">{label}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Live demand drivers" subtitle="Derived Actual from real operations. Sales pipeline has no source of truth yet — Manual / Waiting for Data.">
        <div className="overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle"><tr>{['Driver', 'Current demand', 'Source'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              {DRIVER_ROWS.map((r) => {
                const v = t.drivers[r.key]
                return (
                  <tr key={r.key}>
                    <td className="px-3 py-2 text-ink">{r.label}</td>
                    <td className="px-3 py-2 tabular-nums">{v == null ? <span className="text-subtle">Waiting for Data</span> : (r.fmt ? r.fmt(v) : num(v))}</td>
                    <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${v == null ? 'bg-gray-100 text-gray-500' : 'bg-sky-100 text-sky-700'}`}>{v == null ? 'Manual' : 'Derived Actual'}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Roster & workload" subtitle="Add roles with a capacity driver and per-employee capacity; utilization and hiring needs compute against live demand.">
        <TeamRoster workloads={t.workloads} />
      </Section>
    </div>
  )
}
