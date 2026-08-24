'use client'

import { createClient } from '@/lib/supabase/client'
import type { AttentionItem } from '@/lib/dashboard/impact'

// ── THE SINGLE SOURCE OF TRUTH for unresolved notifications ──────────────────────────────────
// A framework-agnostic pub/sub store. Every surface — dashboard header counter, voice assistant,
// notification bell, and the "Attention Needed" section — reads the SAME derived state and updates
// instantly (no page refresh). "Unresolved" = an active, customer-actionable issue that has not
// been dismissed. Dismiss/resolve state persists per-tenant in localStorage; active issues come
// from the server (seeded by the dashboard, and re-fetched live on realtime lead changes).

export type { AttentionItem }

interface NotifRecord { id: string; createdAt: number; seenAt: number | null; resolvedAt: number | null }
type Records = Record<string, NotifRecord>

export interface AttentionSnapshot {
  ready: boolean
  visibleItems: AttentionItem[]   // active AND not dismissed — the unresolved notifications
  unresolvedCount: number
  /**
   * The inbox's own two groups: drafts waiting on a decision, plus people waiting for a reply.
   *
   * NOT unresolvedCount. That counts notifications, which include month-long tallies like takeovers;
   * this counts what is outstanding right now. The hero's caption and the Needs You card must agree,
   * and they disagreed — "2 things need you" above "Nothing needs you" — because one read each.
   * Carried here rather than fetched separately so it stays live on the same realtime lead signal.
   */
  waiting: number
}

// Stable, count-independent key per issue (3→5 leads is the SAME issue; resolve→recur is new).
const keyOf = (it: AttentionItem) => it.metric || 'attn:' + it.label.replace(/^\d+\s*/, '').trim()
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
const storageKeyFor = (tenantId: string) => `scalix26:attention:${tenantId}`

let tenantId: string | null = null
let activeItems: AttentionItem[] = []
let records: Records = {}
let ready = false
let seeded = false
let waiting = 0
let snapshot: AttentionSnapshot = { ready: false, visibleItems: [], unresolvedCount: 0, waiting: 0 }
const listeners = new Set<() => void>()
let realtimeTenant: string | null = null

function persist() {
  if (!tenantId || typeof window === 'undefined') return
  try { localStorage.setItem(storageKeyFor(tenantId), JSON.stringify(records)) } catch { /* quota */ }
}

function recompute() {
  const visibleItems = activeItems.filter((it) => {
    const r = records[keyOf(it)]
    return !r || r.seenAt == null
  })
  snapshot = { ready, visibleItems, unresolvedCount: visibleItems.length, waiting }
  for (const l of listeners) l()
}

// Reconcile the persisted records with the currently-active issues (new issue → fresh record;
// cleared issue → resolved; recurred issue → new record so it shows again).
function reconcile() {
  const now = Date.now()
  const active = new Set(activeItems.map(keyOf))
  for (const it of activeItems) {
    const k = keyOf(it)
    if (!records[k] || records[k].resolvedAt) records[k] = { id: uid(), createdAt: now, seenAt: null, resolvedAt: null }
  }
  for (const k of Object.keys(records)) {
    if (!active.has(k) && !records[k].resolvedAt) records[k].resolvedAt = now
  }
  persist()
  recompute()
}

export const attentionStore = {
  getSnapshot(): AttentionSnapshot { return snapshot },
  getServerSnapshot(): AttentionSnapshot { return { ready: false, visibleItems: [], unresolvedCount: 0, waiting: 0 } },

  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  },

  /** Bind a tenant: load persisted dismiss state, wire realtime, and do an initial fetch if the
   *  dashboard hasn't already seeded fresh server data. */
  setTenant(id: string) {
    if (tenantId === id && ready) { this.ensureRealtime(id); return }
    tenantId = id
    if (typeof window !== 'undefined') {
      try { records = JSON.parse(localStorage.getItem(storageKeyFor(id)) || '{}') } catch { records = {} }
    }
    ready = true
    reconcile()
    this.ensureRealtime(id)
    if (!seeded) this.refresh()
  },

  /** Seed active issues directly from server-rendered data (instant, no flash). */
  seed(items: AttentionItem[], seededWaiting = 0) {
    seeded = true
    waiting = seededWaiting
    activeItems = items || []
    if (ready) reconcile(); else recompute()
  },

  /** Re-fetch the current active issues from the server (live updates). */
  async refresh() {
    try {
      const res = await fetch('/api/dashboard/attention', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      activeItems = (j.items || []) as AttentionItem[]
      waiting = typeof j.waiting === 'number' ? j.waiting : waiting
      seeded = true
      if (ready) reconcile(); else recompute()
    } catch { /* offline — keep last known */ }
  },

  /** Dismiss one unresolved notification. Updates every consumer instantly. */
  dismiss(item: AttentionItem) {
    const k = keyOf(item)
    const rec = records[k] || { id: uid(), createdAt: Date.now(), seenAt: null, resolvedAt: null }
    records[k] = { ...rec, seenAt: Date.now() }
    persist()
    recompute()
  },

  /** One realtime subscription (leads) → live refresh. Cross-tab sync via the storage event. */
  ensureRealtime(id: string) {
    if (typeof window === 'undefined' || realtimeTenant === id) return
    realtimeTenant = id
    const supabase = createClient()
    supabase.channel(`attention:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `tenant_id=eq.${id}` }, () => this.refresh())
      .subscribe()
    window.addEventListener('storage', (e) => {
      if (e.key === storageKeyFor(id)) {
        try { records = JSON.parse(e.newValue || '{}') } catch { /* ignore */ }
        recompute()
      }
    })
    window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.refresh() })
  },
}
