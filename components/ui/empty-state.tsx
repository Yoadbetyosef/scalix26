import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Storytelling empty state. Not "there's nothing here" — a calm reassurance that the
 * AI is on duty and waiting. The accent tile breathes a soft "listening" halo so even
 * an empty screen feels alive. Stills under prefers-reduced-motion.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: ElementType
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-20 text-center sx-animate-in', className)}>
      <div className="relative mb-5">
        <span className="absolute inset-0 rounded-2xl bg-accent/30 sx-halo" aria-hidden="true" />
        <span className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-white shadow-e2">
          <Icon className="h-7 w-7" strokeWidth={1.75} />
        </span>
      </div>
      <p className="text-lg font-light tracking-tight text-ink">{title}</p>
      {children && <p className="mt-2 max-w-sm text-sm text-muted leading-relaxed">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
