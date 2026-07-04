'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, CheckCircle2, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { AttentionItem } from '@/lib/dashboard/impact'

// A dismissable "Attention Needed" list. Dismiss ≠ Resolve: clicking X only marks the
// notification "seen" so it stops cluttering the dashboard — the underlying business state is
// untouched. Persistence (localStorage, per tenant — same pattern as the notification center):
//   • Each active issue gets a notification record { id, createdAt, seenAt, resolvedAt }.
//   • Dismiss sets seenAt → hidden while the issue stays active (survives reloads, not just the
//     session).
//   • When an issue is no longer active it's marked resolvedAt. If it recurs later, a NEW
//     notification (new id, seenAt: null) is created, so it shows again.
interface NotifRecord { id: string; createdAt: number; seenAt: number | null; resolvedAt: number | null }
type Store = Record<string, NotifRecord>

// Stable, count-independent key per issue (so 3→5 leads is the SAME active issue, but a
// resolve→recur makes a new notification).
const keyOf = (it: AttentionItem) => it.metric || 'attn:' + it.label.replace(/^\d+\s*/, '').trim()
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)

export function AttentionNeeded({ items, tenantId, onOpenMetric }: {
  items: AttentionItem[]
  tenantId: string
  onOpenMetric: (item: AttentionItem) => void
}) {
  const storageKey = `scalix26:attention:${tenantId}`
  const [ready, setReady] = useState(false)
  const [store, setStore] = useState<Store>({})
  const [removing, setRemoving] = useState<Record<string, true>>({})

  // Reconcile the saved notifications with the currently-active issues.
  useEffect(() => {
    let s: Store = {}
    try { s = JSON.parse(localStorage.getItem(storageKey) || '{}') } catch { /* corrupt → reset */ }
    const now = Date.now()
    const active = new Set(items.map(keyOf))
    for (const it of items) {
      const k = keyOf(it)
      // New issue, or one that had resolved and is happening again → fresh notification.
      if (!s[k] || s[k].resolvedAt) s[k] = { id: uid(), createdAt: now, seenAt: null, resolvedAt: null }
    }
    for (const k of Object.keys(s)) {
      if (!active.has(k) && !s[k].resolvedAt) s[k].resolvedAt = now // issue cleared
    }
    try { localStorage.setItem(storageKey, JSON.stringify(s)) } catch { /* quota */ }
    setStore(s); setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, items.map(keyOf).join('|')])

  function dismiss(it: AttentionItem) {
    const k = keyOf(it)
    setRemoving((r) => ({ ...r, [k]: true })) // start slide/fade-out
    setStore((prev) => {
      const rec = prev[k] || { id: uid(), createdAt: Date.now(), resolvedAt: null, seenAt: null }
      const next: Store = { ...prev, [k]: { ...rec, seenAt: Date.now() } }
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
    window.setTimeout(() => setRemoving((r) => { const n = { ...r }; delete n[k]; return n }), 320)
  }

  // Visible = active items not yet seen (kept mounted while animating out).
  const visible = items.filter((it) => { const k = keyOf(it); return removing[k] || !store[k] || store[k].seenAt == null })

  if (ready && visible.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
          <span className="text-sm text-ink">You&apos;re all caught up — Scalix has everything handled.</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className={`space-y-2 transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`}>
      {visible.map((item) => {
        const k = keyOf(item)
        const gone = !!removing[k]
        const metric = item.metric
        const label = <span className="min-w-0 flex-1 truncate text-sm font-medium text-amber-900">{item.label}</span>
        const openIcon = <ArrowUpRight className="w-4 h-4 flex-shrink-0 text-amber-400" />
        const clickableCls = 'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 -mx-1 -my-1 transition-colors active:bg-amber-100'
        return (
          <div key={k} className={`overflow-hidden transition-all duration-300 ease-out ${gone ? 'max-h-0 -translate-x-3 opacity-0' : 'max-h-28 opacity-100'}`}>
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-500" />
              {metric ? (
                <button onClick={() => onOpenMetric(item)} className={`${clickableCls} text-left`}>{label}{openIcon}</button>
              ) : (
                <Link href={item.href} className={clickableCls}>{label}{openIcon}</Link>
              )}
              <button
                onClick={() => dismiss(item)}
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
