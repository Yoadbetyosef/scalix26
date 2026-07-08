'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Bell, X } from 'lucide-react'

interface Notif { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

export function PartnerNotifications() {
  const [items, setItems] = useState<Notif[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/partner/notifications')
    if (!res.ok) return
    const j = await res.json(); setItems(j.notifications || []); setUnread(j.unread || 0)
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])

  async function markAll() {
    await fetch('/api/partner/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) })
    load()
  }

  return (
    <>
      <button onClick={() => { setOpen(true); if (unread) markAll() }}
        className="fixed right-4 top-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-hairline bg-white shadow-e2 md:bottom-6 md:right-6 md:top-auto">
        <Bell className="h-5 w-5 text-subtle" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-start md:justify-end md:p-6" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-t-2xl bg-white shadow-2xl md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
              <span className="font-semibold text-ink">Notifications</span>
              <button onClick={() => setOpen(false)} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {items.length === 0 ? <div className="px-4 py-10 text-center text-sm text-muted">No notifications yet.</div> : (
                <div className="divide-y divide-hairline">
                  {items.map((n) => {
                    const inner = (
                      <div className={`px-4 py-3 ${n.read_at ? '' : 'bg-accent/5'}`}>
                        <div className="text-sm font-medium text-ink">{n.title}</div>
                        {n.body && <div className="mt-0.5 text-sm text-subtle">{n.body}</div>}
                        <div className="mt-0.5 text-xs text-muted">{new Date(n.created_at).toLocaleString()}</div>
                      </div>
                    )
                    return n.link
                      ? <Link key={n.id} href={n.link} onClick={() => setOpen(false)} className="block hover:bg-sunken/50">{inner}</Link>
                      : <div key={n.id}>{inner}</div>
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
