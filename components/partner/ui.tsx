import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Flame, Link2, MonitorPlay, Send, Eye, TrendingDown, Zap, GraduationCap, DollarSign, PenLine, Sparkles, Building2, Users, Megaphone, type LucideIcon } from 'lucide-react'

// Maps Coach/dashboard icon keys → Scalix icon system (no emoji anywhere in the product).
const COACH_ICONS: Record<string, LucideIcon> = {
  flame: Flame, link: Link2, demo: MonitorPlay, send: Send, eye: Eye, trend: TrendingDown,
  zap: Zap, cert: GraduationCap, earnings: DollarSign, write: PenLine,
  customer: Building2, team: Users, campaign: Megaphone,
}
export function CoachIcon({ name, className }: { name: string; className?: string }) {
  const Icon = COACH_ICONS[name] || Sparkles
  return <Icon className={className || 'h-5 w-5'} />
}

// Small shared primitives for the partner portal so every page has consistent, premium chrome.

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-subtle">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// Metric card — the number dominates; label + hint are quiet context. Fixed min-height so a row of
// cards aligns perfectly regardless of whether a hint is present.
export function StatCard({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <div className={cn('flex min-h-[104px] flex-col justify-between rounded-2xl border bg-surface p-4 shadow-e1', accent ? 'border-accent/30' : 'border-hairline')}>
      <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted truncate">{label}</div>
      <div>
        <div className={cn('text-[27px] font-semibold leading-none tracking-tight tabular-nums', accent ? 'text-accent-strong' : 'text-ink')}>{value}</div>
        {hint && <div className="mt-1.5 text-xs leading-snug text-subtle">{hint}</div>}
      </div>
    </div>
  )
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-hairline bg-surface shadow-e1', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          {title && <h2 className="font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 px-4 py-10 text-center text-sm text-muted">{children}</div>
}

const money = (cents: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 2 }).format((cents || 0) / 100)
export { money }
