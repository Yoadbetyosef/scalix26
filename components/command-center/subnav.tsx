'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Grouped navigation — the founder sees 8 primary groups, not 17 flat tabs. Each group reveals its sub-pages
// only when active. Deeper planning surfaces (Mission / War Room / Scoreboard) live under Plan as advanced.
const BASE = '/admin/command-center'
interface Group { label: string; href: string; subs: { label: string; href: string }[] }
const NAV: Group[] = [
  { label: 'Overview', href: BASE, subs: [] },
  { label: 'Plan', href: `${BASE}/plan`, subs: [{ label: 'Plan', href: `${BASE}/plan` }, { label: 'Mission', href: `${BASE}/mission` }, { label: 'War Room', href: `${BASE}/war-room` }, { label: 'Scoreboard', href: `${BASE}/scoreboard` }] },
  { label: 'Growth', href: `${BASE}/growth-engines`, subs: [{ label: 'Growth Engines', href: `${BASE}/growth-engines` }] },
  { label: 'Customers', href: `${BASE}/customer-lifecycle`, subs: [{ label: 'Lifecycle', href: `${BASE}/customer-lifecycle` }, { label: 'Onboarding', href: `${BASE}/onboarding` }, { label: 'Retention', href: `${BASE}/retention` }] },
  { label: 'Operations', href: `${BASE}/support-ops`, subs: [{ label: 'Support', href: `${BASE}/support-ops` }, { label: 'Team', href: `${BASE}/team` }] },
  { label: 'Financials', href: `${BASE}/revenue`, subs: [{ label: 'Revenue', href: `${BASE}/revenue` }, { label: 'Costs', href: `${BASE}/costs` }, { label: 'Unit Economics', href: `${BASE}/unit-economics` }, { label: 'Forecast', href: `${BASE}/forecast` }] },
  { label: 'Scenarios', href: `${BASE}/scenarios`, subs: [{ label: 'Scenarios', href: `${BASE}/scenarios` }] },
  { label: 'Settings', href: `${BASE}/settings`, subs: [{ label: 'Settings', href: `${BASE}/settings` }, { label: 'Actuals', href: `${BASE}/actuals` }] },
]

export function Subnav() {
  const p = usePathname()
  const activeGroup = NAV.find((g) => g.subs.some((s) => p === s.href || (s.href !== BASE && p.startsWith(s.href)))) ?? NAV.find((g) => (g.href === BASE ? p === BASE : p.startsWith(g.href))) ?? NAV[0]
  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-x-1 border-b border-hairline">
        {NAV.map((g) => {
          const active = g.label === activeGroup.label
          return <Link key={g.label} href={g.href} className={`px-3 py-2 text-sm ${active ? 'border-b-2 border-ink font-medium text-ink' : 'text-subtle hover:text-ink'}`}>{g.label}</Link>
        })}
      </div>
      {activeGroup.subs.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-1">
          {activeGroup.subs.map((s) => {
            const active = p === s.href || (s.href !== BASE && p.startsWith(s.href))
            return <Link key={s.href} href={s.href} className={`rounded-full px-3 py-1 text-xs ${active ? 'bg-ink text-white' : 'text-subtle hover:text-ink'}`}>{s.label}</Link>
          })}
        </div>
      )}
    </div>
  )
}
