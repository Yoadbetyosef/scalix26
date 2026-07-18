'use client'

import type { ElementType } from 'react'
import { cn } from '@/lib/utils'

// Underline tab bar (SCALIX language). Presentational + controlled by the parent (parent renders the active
// panel). Horizontally scrollable on mobile. Reused by product detail, sales documents, etc.
export interface TabItem { key: string; label: string; icon?: ElementType; badge?: string | number }

export function Tabs({ tabs, value, onChange, className }: { tabs: TabItem[]; value: string; onChange: (key: string) => void; className?: string }) {
  return (
    <div className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-hairline', className)} role="tablist">
      {tabs.map((t) => {
        const active = t.key === value
        const Icon = t.icon
        return (
          <button
            key={t.key} role="tab" aria-selected={active} onClick={() => onChange(t.key)}
            className={cn(
              'relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'border-accent text-ink' : 'border-transparent text-subtle hover:text-ink',
            )}
          >
            {Icon && <Icon className="h-4 w-4" strokeWidth={1.75} />}
            {t.label}
            {t.badge != null && t.badge !== '' && (
              <span className={cn('ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', active ? 'bg-accent/10 text-accent-strong' : 'bg-sunken text-muted')}>{t.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
