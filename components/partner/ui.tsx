import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

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

export function StatCard({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <div className={cn('rounded-2xl border border-hairline bg-surface p-4 shadow-e1', accent && 'ring-1 ring-accent/20')}>
      <div className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-subtle">{hint}</div>}
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
