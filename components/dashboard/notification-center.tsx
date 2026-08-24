'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, X, ArrowUpRight, AlertTriangle } from 'lucide-react'
import { useAttention } from '@/components/dashboard/attention'
import { attentionStore } from '@/lib/dashboard/attention-store'

/**
 * The notification bell — mounted globally (Sidebar), on every page. It reads the SINGLE source of
 * truth (attentionStore): the exact same unresolved notifications shown by the dashboard header,
 * voice assistant, and "Attention Needed" section. The badge is the live unresolved count; the
 * panel lists each unresolved item (dismissable). Everything updates instantly, no page refresh.
 */
export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const { ready, visibleItems, unresolvedCount } = useAttention()

  // Bind the ACTIVE business tenant once → the store loads dismiss state, wires realtime, and fetches
  // the count. Resolved server-side (validated active workspace) so a White Label partner operating a
  // client binds to the CLIENT's tenant, never the operator's own. Never derive tenant from user_id here.
  useEffect(() => {
    ;(async () => {
      const j = await fetch('/api/me/context').then((r) => r.json()).catch(() => null)
      if (!j?.tenantId) return
      setTenantId(j.tenantId)
      attentionStore.setTenant(j.tenantId)
    })()
  }, [])

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        /* THE BELL IS BOTTOM-RIGHT AT EVERY WIDTH NOW.
           It used to be top-right on mobile, at right-3 / top-8px, 44x44. A page header puts its
           right-hand control in exactly that square — /inbox/[id] puts contact info at x336 y17,
           38x38 — so the bell covered it and took the tap. Playwright could not reach the button
           even with force:true; a person cannot reach it at all, which means contact info was
           unreachable on a phone on a live screen.
           Repositioned rather than made to yield, because yielding is per-page: it would have to be
           re-checked on every screen of the migration, and the next header control to land in that
           corner would break it again silently. Bottom-right is the corner no page header uses and
           it is where the bell already lives on desktop.
           The offset used to clear the 60px tab bar. The tab bar is gone — /v2's swipe-up sheet
           replaced it — so it now clears the sheet's HANDLE instead, which is a 48px strip on the
           bottom edge running the full width. 56px puts the bell's lower edge 8px above it. That
           strip is inside a host at z-index 55, above this bell at 50, so an overlap would not be
           a near miss: the handle would simply take the tap.
           The dashboard's Talk button is the one other control near it: measured at x108-283 on a
           390px phone, so it ends 51px before the bell begins. */
        className="fixed z-50 flex items-center justify-center transition-all duration-200 active:scale-95
                   right-3 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] h-11 w-11 rounded-full bg-white/90 text-ink shadow-e2 ring-1 ring-hairline backdrop-blur hover:bg-white
                   md:right-4 md:bottom-4 md:h-14 md:w-14 md:rounded-full md:bg-ink md:text-white md:shadow-e3 md:ring-0 md:backdrop-blur-none md:hover:bg-ink/90 md:hover:shadow-e4 md:hover:-translate-y-0.5"
      >
        <Bell className="w-[22px] h-[22px]" strokeWidth={1.75} />
        {unresolvedCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 px-1 flex items-center justify-center bg-danger text-white text-[11px] font-semibold rounded-full ring-2 ring-white">
            {unresolvedCount > 9 ? '9+' : unresolvedCount}
          </span>
        ) : tenantId ? (
          // Idle but live — a calm green pulse signals the AI is on duty and watching.
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
          </span>
        ) : null}
      </button>

      {open && (
        <>
          <div className="md:hidden fixed inset-0 bg-ink/30 backdrop-blur-sm z-50 animate-fade-in" onClick={() => setOpen(false)} />
          <div className="fixed z-50 bg-white shadow-e4 flex flex-col animate-slide-up
                          inset-x-0 bottom-0 max-h-[75vh] rounded-t-3xl
                          md:inset-x-auto md:bottom-24 md:right-4 md:w-[26rem] md:max-h-[30rem] md:rounded-3xl md:border md:border-hairline">
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0">
              <span className="text-[15px] font-medium tracking-tight text-ink">Notifications</span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="w-9 h-9 -mr-2 flex items-center justify-center rounded-full hover:bg-sunken text-muted transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-2 pb-2 space-y-1">
              {ready && visibleItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-sunken flex items-center justify-center text-muted mb-3">
                    <Bell className="w-6 h-6" strokeWidth={1.5} />
                  </div>
                  <p className="text-sm text-subtle">You&apos;re all caught up</p>
                  <p className="text-xs text-muted mt-0.5">Anything that needs you will show up here.</p>
                </div>
              ) : (
                visibleItems.map((item) => (
                  <div key={item.metric || item.label} className="flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-sunken transition-colors">
                    <span className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-amber-50 text-amber-500">
                      <AlertTriangle className="w-[18px] h-[18px]" strokeWidth={2} />
                    </span>
                    <Link href={item.href} onClick={() => setOpen(false)} className="flex-1 min-w-0 flex items-center gap-1">
                      <p className="text-sm font-medium text-ink truncate">{item.label}</p>
                      <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 text-muted" />
                    </Link>
                    <button
                      onClick={() => attentionStore.dismiss(item)}
                      aria-label="Dismiss"
                      className="flex-shrink-0 rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink transition-colors active:scale-90"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
