'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { attentionStore, type AttentionItem, type AttentionSnapshot } from '@/lib/dashboard/attention-store'

// The one hook every surface reads. Instant, tear-free updates via useSyncExternalStore.
export function useAttention(): AttentionSnapshot {
  return useSyncExternalStore(attentionStore.subscribe, attentionStore.getSnapshot, attentionStore.getServerSnapshot)
}

/**
 * Binds the tenant + seeds the server-computed active issues into the store (instant, no flash).
 * Mount once on the dashboard. The notification bell also binds the tenant globally, so the count
 * is correct on every page — this just gives the dashboard the freshest data with zero flicker.
 */
export function AttentionSync({ tenantId, items, waiting = 0 }: { tenantId: string; items: AttentionItem[]; waiting?: number }) {
  useEffect(() => {
    attentionStore.setTenant(tenantId)
    attentionStore.seed(items, waiting)
    // Re-seed when the server-rendered items change (navigation / refresh).
  }, [tenantId, JSON.stringify(items), waiting])
  return null
}

const phrase = (n: number) => `${n} ${n === 1 ? 'thing needs' : 'things need'} your attention.`

/** The reactive dashboard sentence. Before hydration it shows the server value (no flash). */
export function AttentionSentence({ initial, idleSentence }: { initial: string; idleSentence: string }) {
  const { ready, unresolvedCount } = useAttention()
  if (!ready) return <>{initial}</>
  return <>{unresolvedCount > 0 ? phrase(unresolvedCount) : idleSentence}</>
}

/** The mobile amber attention banner — shows only while there are unresolved notifications. */
export function AttentionPill({ initialVisible }: { initialVisible: boolean }) {
  const { ready, unresolvedCount } = useAttention()
  const show = ready ? unresolvedCount > 0 : initialVisible
  if (!show) return null
  return (
    <a href="#attention-needed" className="mb-4 flex min-h-[48px] items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-left text-amber-900 transition-colors active:bg-amber-100 md:hidden">
      <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" strokeWidth={2} />
      <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug"><AttentionSentence initial={phrase(1)} idleSentence="" /></span>
      <ChevronRight className="h-5 w-5 flex-shrink-0 text-amber-500" />
    </a>
  )
}
