'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, CheckCircle2, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { AttentionItem } from '@/lib/dashboard/impact'
import { useAttention } from '@/components/dashboard/attention'
import { attentionStore } from '@/lib/dashboard/attention-store'
import { useBrand } from '@/components/brand/brand-provider'

// The "Attention Needed" list. Reads the SINGLE source of truth (attentionStore) — the exact same
// unresolved-notification state as the dashboard header, voice assistant, and notification bell.
// Dismiss ≠ Resolve: it marks the notification seen (persisted per-tenant); the underlying business
// state is untouched, and every surface updates instantly.
export function AttentionNeeded({ onOpenMetric }: {
  items?: AttentionItem[]        // kept for API compatibility; the store is authoritative
  tenantId?: string
  onOpenMetric: (item: AttentionItem) => void
}) {
  const { ready, visibleItems } = useAttention()
  const brandName = useBrand()?.name || 'Scalix'

  if (ready && visibleItems.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
          <span className="text-sm text-ink">You&apos;re all caught up — {brandName} has everything handled.</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className={`space-y-2 transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`}>
      {visibleItems.map((item) => {
        const label = <span className="min-w-0 flex-1 truncate text-sm font-medium text-amber-900">{item.label}</span>
        const openIcon = <ArrowUpRight className="w-4 h-4 flex-shrink-0 text-amber-400" />
        const clickableCls = 'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 -mx-1 -my-1 transition-colors active:bg-amber-100'
        return (
          <div key={item.metric || item.label} className="overflow-hidden transition-all duration-300 ease-out">
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-500" />
              {item.metric ? (
                <button onClick={() => onOpenMetric(item)} className={`${clickableCls} text-left`}>{label}{openIcon}</button>
              ) : (
                <Link href={item.href} className={clickableCls}>{label}{openIcon}</Link>
              )}
              <button
                onClick={() => attentionStore.dismiss(item)}
                aria-label="Dismiss notification"
                className="flex-shrink-0 rounded-lg p-2 text-amber-500 transition-all hover:bg-amber-200/60 active:scale-90 [-webkit-tap-highlight-color:transparent]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
