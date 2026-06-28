'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, X, Phone, Check, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Notif = {
  id: string // `${leadId}:${type}` — dedupes repeated events
  type: 'new' | 'booked'
  leadId: string
  name: string | null
  phone: string | null
  ts: number
  read: boolean
}

const MAX_NOTIFS = 50

function relativeTime(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (sec < 60) return 'Just now'
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`
  return `${Math.floor(sec / 86400)} d ago`
}

/**
 * Persistent notification center (Instagram/WhatsApp style). A fixed bell in
 * the bottom-right corner with an unread badge; clicking opens a panel
 * (bottom-sheet on mobile, floating on desktop) listing new-lead and
 * lead-booked events from Supabase Realtime. Notifications persist in
 * localStorage. Mounted from the Sidebar, so it runs on every page.
 */
export function NotificationCenter() {
  const router = useRouter()
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [open, setOpen] = useState(false)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const storageKey = tenantId ? `scalix26:notifications:${tenantId}` : null

  // Keep a ref so the realtime callback can dedupe against current state.
  const notifsRef = useRef<Notif[]>([])
  notifsRef.current = notifs

  const addNotif = useCallback((n: Notif) => {
    if (notifsRef.current.some((x) => x.id === n.id)) return
    setNotifs((prev) => [n, ...prev].slice(0, MAX_NOTIFS))
  }, [])

  // Resolve tenant + load persisted notifications.
  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user.id).single()
      if (!tenant) return
      setTenantId(tenant.id)

      try {
        const saved = localStorage.getItem(`scalix26:notifications:${tenant.id}`)
        if (saved) setNotifs(JSON.parse(saved))
      } catch { /* ignore corrupt storage */ }

      channel = supabase
        .channel('notification-center')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tenant.id}` },
          (payload) => {
            const l = payload.new as { id: string; name?: string | null; phone?: string | null }
            addNotif({ id: `${l.id}:new`, type: 'new', leadId: l.id, name: l.name ?? null, phone: l.phone ?? null, ts: Date.now(), read: false })
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tenant.id}` },
          (payload) => {
            const l = payload.new as { id: string; name?: string | null; phone?: string | null; status?: string }
            if (l.status === 'booked') {
              addNotif({ id: `${l.id}:booked`, type: 'booked', leadId: l.id, name: l.name ?? null, phone: l.phone ?? null, ts: Date.now(), read: false })
            }
          },
        )
        .subscribe()
    })()

    return () => { if (channel) supabase.removeChannel(channel) }
  }, [addNotif])

  // Persist on change.
  useEffect(() => {
    if (!storageKey) return
    try { localStorage.setItem(storageKey, JSON.stringify(notifs)) } catch { /* quota */ }
  }, [notifs, storageKey])

  const unread = notifs.filter((n) => !n.read).length

  // Where a notification routes to its relevant existing record: a booked lead → the
  // Appointments view, any other lead event → the Leads view. (Navigation only; nothing
  // about how notifications are generated/stored/read changes.)
  function hrefFor(n: Notif): string {
    return n.type === 'booked' ? '/dashboard?tab=appointments' : '/dashboard?tab=leads'
  }
  function openNotif(n: Notif) {
    router.push(hrefFor(n))
    setOpen(false) // close the popover after navigating
  }

  function toggle() {
    setOpen((o) => {
      const next = !o
      if (next && unread > 0) {
        // Opening the panel marks everything as read.
        setNotifs((prev) => prev.map((n) => ({ ...n, read: true })))
      }
      return next
    })
  }

  return (
    <>
      {/* Bell — sits above the mobile bottom nav, bottom-right on desktop */}
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="fixed bottom-20 right-4 md:bottom-4 z-50 w-14 h-14 rounded-full bg-ink text-white shadow-e3 flex items-center justify-center transition-all duration-200 hover:bg-ink/90 hover:shadow-e4 hover:-translate-y-0.5 active:scale-95"
      >
        <Bell className="w-[22px] h-[22px]" strokeWidth={1.75} />
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 px-1 flex items-center justify-center bg-danger text-white text-[11px] font-semibold rounded-full ring-2 ring-white">
            {unread > 9 ? '9+' : unread}
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
          {/* Backdrop (mobile only) */}
          <div className="md:hidden fixed inset-0 bg-ink/30 backdrop-blur-sm z-50 animate-fade-in" onClick={() => setOpen(false)} />

          {/* Panel: bottom-sheet on mobile, floating card on desktop */}
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
              {notifs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-sunken flex items-center justify-center text-muted mb-3">
                    <Bell className="w-6 h-6" strokeWidth={1.5} />
                  </div>
                  <p className="text-sm text-subtle">You&apos;re all caught up</p>
                  <p className="text-xs text-muted mt-0.5">New leads and bookings will appear here.</p>
                </div>
              ) : (
                notifs.map((n) => {
                  const booked = n.type === 'booked'
                  return (
                    <div
                      key={n.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openNotif(n)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNotif(n) } }}
                      className="sx-animate-in flex items-center gap-3 px-3 py-3 rounded-2xl cursor-pointer hover:bg-sunken transition-colors"
                    >
                      {/* Colored indicator tile — booked is a calm win, a new lead is energy */}
                      <span className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${booked ? 'bg-emerald-50 text-emerald-600' : 'bg-accent/10 text-accent-strong'}`}>
                        {booked ? <Check className="w-[18px] h-[18px]" strokeWidth={2} /> : <Sparkles className="w-[18px] h-[18px]" strokeWidth={1.75} />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink truncate">
                          {booked ? 'Appointment booked' : 'New lead'} · {n.name || 'Unknown'}
                        </p>
                        {!booked && n.phone && (
                          <p className="text-xs text-subtle mt-0.5 truncate">{n.phone}</p>
                        )}
                        <p className="text-xs text-muted mt-0.5">{relativeTime(n.ts)}</p>
                      </div>
                      {!booked && n.phone && (
                        <a
                          href={`tel:${n.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="tap-target inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-ink text-white hover:bg-ink/90 transition-colors flex-shrink-0"
                        >
                          <Phone className="w-3.5 h-3.5" strokeWidth={2} /> Call
                        </a>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
