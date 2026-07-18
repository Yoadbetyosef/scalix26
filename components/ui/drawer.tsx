'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Right-side sheet (SCALIX language). Controlled. Closes on backdrop click + Escape. Mobile: full-width.
export function Drawer({ open, onClose, title, children, footer, className }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; className?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40 sx-animate-in" onClick={onClose} aria-hidden="true" />
      <div className={cn('relative flex h-full w-full max-w-md flex-col bg-surface shadow-e4', className)}>
        <header className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="text-base font-medium text-ink">{title}</h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="shrink-0 border-t border-hairline px-4 py-3">{footer}</footer>}
      </div>
    </div>
  )
}
