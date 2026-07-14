'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Implemented tabs are links; the rest are placeholders (later phases) — no broken routes.
const TABS: { label: string; href?: string }[] = [
  { label: 'Overview', href: '/admin/command-center' },
  { label: 'Customer Lifecycle', href: '/admin/command-center/customer-lifecycle' },
  { label: 'Retention', href: '/admin/command-center/retention' },
  { label: 'Onboarding', href: '/admin/command-center/onboarding' },
  { label: 'Actuals', href: '/admin/command-center/actuals' },
  { label: 'Scoreboard', href: '/admin/command-center/scoreboard' },
  { label: 'Settings', href: '/admin/command-center/settings' },
  { label: 'Mission' }, { label: 'War Room' }, { label: 'Support & Ops' }, { label: 'Forecast' },
  { label: 'Growth Engines' }, { label: 'Revenue' }, { label: 'Costs' }, { label: 'Team' }, { label: 'Unit Economics' }, { label: 'Scenarios' },
]

export function Subnav() {
  const p = usePathname()
  return (
    <div className="mb-6 flex flex-wrap gap-x-1 border-b border-hairline">
      {TABS.map((t) => {
        const active = !!t.href && (t.href === '/admin/command-center' ? p === t.href : p.startsWith(t.href))
        return t.href ? (
          <Link key={t.label} href={t.href} className={`px-3 py-2 text-sm ${active ? 'border-b-2 border-ink font-medium text-ink' : 'text-subtle hover:text-ink'}`}>{t.label}</Link>
        ) : (
          <span key={t.label} className="px-3 py-2 text-sm text-subtle">{t.label}<span className="ml-1 rounded bg-sunken px-1 text-[10px]">soon</span></span>
        )
      })}
    </div>
  )
}
