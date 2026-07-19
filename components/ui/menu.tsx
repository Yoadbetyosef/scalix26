'use client'

import { useState, type ElementType } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

// Lightweight dropdown menu (labeled, accessible). Trigger + click-outside popover. Reused for the
// component overflow menu and the product "More actions" menu — no bare icons without a label.
export interface MenuItem { label: string; icon?: ElementType; onClick: () => void; destructive?: boolean }

export function Menu({ items, label, icon: Icon = MoreHorizontal, align = 'right', ariaLabel, buttonClassName }: {
  items: MenuItem[]; label?: string; icon?: ElementType; align?: 'left' | 'right'; ariaLabel?: string; buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel ?? label ?? 'More actions'}
        className={cn(buttonClassName ?? 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 text-sm text-ink hover:bg-sunken')}
      >
        <Icon className="h-4 w-4" />{label && <span>{label}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div role="menu" className={cn('absolute z-50 mt-1 min-w-48 rounded-card border border-hairline bg-surface p-1 shadow-e3', align === 'right' ? 'right-0' : 'left-0')}>
            {items.map((it, i) => {
              const ItIcon = it.icon
              return (
                <button key={i} role="menuitem" onClick={() => { setOpen(false); it.onClick() }}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors', it.destructive ? 'text-danger hover:bg-danger/[0.06]' : 'text-ink hover:bg-sunken')}>
                  {ItIcon && <ItIcon className="h-4 w-4 shrink-0" />}{it.label}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
