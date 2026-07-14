import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getTeamCapacity } from '@/lib/command-center/ops-adapters'
import { num, Section } from '@/components/command-center/ui'
import { TeamTabs } from '@/components/command-center/team-tabs'

export const dynamic = 'force-dynamic'

const DRIVER_ROWS: { key: 'support_hours' | 'onboarding_accounts' | 'cs_customers' | 'producing_agencies' | 'active_affiliates' | 'sales_opportunities'; label: string; fmt?: (v: number) => string }[] = [
  { key: 'support_hours', label: 'Support incident hours / week', fmt: (v) => `${v.toFixed(1)}h` },
  { key: 'onboarding_accounts', label: 'Accounts in onboarding' },
  { key: 'cs_customers', label: 'Activated customers' },
  { key: 'producing_agencies', label: 'Active agencies' },
  { key: 'active_affiliates', label: 'Active affiliates' },
  { key: 'sales_opportunities', label: 'Sales opportunities' },
]

// Team & Capacity V2 — three strictly-separated layers: Team Reality (today's org), Hiring Plan (future
// hires), and Capacity Model (config). Current headcount/payroll are reality-only and never include planned
// or simulated hires. Capacity is measured against REAL, period-normalized demand — never customer count.
export default async function TeamPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const t = await getTeamCapacity()

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Team &amp; Capacity</h2>
        <p className="text-sm text-subtle">Reality · Plan · Config, kept strictly separate. Hires are recommended only from real capacity gaps; demand and capacity are normalized to the same period before utilization.</p>
      </div>

      <Section title="Live demand drivers" subtitle="Derived Actual from real operations. Sales pipeline has no source of truth yet — Waiting for Data.">
        <div className="overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle"><tr>{['Driver', 'Current demand', 'Source'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              {DRIVER_ROWS.map((r) => {
                const v = t.drivers[r.key]?.value ?? null
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

      <Section title="Organization" subtitle="Team Reality is today's org; Hiring Plan is future only; Capacity Model holds the assumptions. They never mix.">
        <TeamTabs workloads={t.workloads} headcount={t.headcount} plan={t.plan} models={t.models} />
      </Section>
    </div>
  )
}
