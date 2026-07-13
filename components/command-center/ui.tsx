import type { ReactNode } from 'react'
import type { Health } from '@/lib/command-center/types'
import { compactMoney, pctText, num } from '@/lib/command-center/format'

// Executive presentation primitives for the CEO Command Center. Server components (no client JS).
// Matches the admin design tokens (text-ink / text-subtle / border-hairline-strong / bg-white / bg-sunken).
export { compactMoney, pctText, num }

const HEALTH_DOT: Record<Health, string> = { green: 'bg-emerald-500', yellow: 'bg-amber-500', red: 'bg-red-500' }
const HEALTH_TEXT: Record<Health, string> = { green: 'text-emerald-600', yellow: 'text-amber-600', red: 'text-red-600' }

export function HealthDot({ health }: { health: Health }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${HEALTH_DOT[health]}`} aria-label={health} />
}

export function KpiCard({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-hairline-strong bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone || 'text-ink'}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-xs text-subtle">{sub}</div>}
    </div>
  )
}

export function EngineCard({ label, health, primary, secondary, contributionPct, trend, action }: {
  label: string; health: Health; primary: string; secondary: string; contributionPct: number; trend: 'up' | 'flat' | 'down'; action?: ReactNode
}) {
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '▬'
  return (
    <div className="flex flex-col rounded-xl border border-hairline-strong bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><HealthDot health={health} /><span className="font-semibold text-ink">{label}</span></div>
        <span className={`text-xs ${HEALTH_TEXT[health]}`}>{arrow}</span>
      </div>
      <div className="mt-2 text-xl font-bold tabular-nums text-ink">{primary}</div>
      <div className="text-xs text-subtle">{secondary}</div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-sunken">
        <div className="h-1.5 rounded-full bg-ink/70" style={{ width: `${Math.min(100, Math.round(contributionPct * 100))}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-subtle">{pctText(contributionPct)} of MRR</div>
      {action != null && <div className="mt-3 border-t border-hairline pt-2 text-xs">{action}</div>}
    </div>
  )
}

export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {subtitle && <p className="mb-3 text-sm text-subtle">{subtitle}</p>}
      {children}
    </section>
  )
}
