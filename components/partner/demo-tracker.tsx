'use client'

import { useEffect, useRef } from 'react'

// Records a demo view + time-on-demo from the public demo page. Uses a stable local visitor id so
// repeat opens don't inflate unique visitors, and sendBeacon so dwell survives page close.
export function DemoTracker({ slug }: { slug: string }) {
  const viewId = useRef<string | null>(null)
  const start = useRef<number>(Date.now())

  useEffect(() => {
    let vid = ''
    try {
      vid = localStorage.getItem('sx_demo_vid') || ''
      if (!vid) { vid = crypto.randomUUID(); localStorage.setItem('sx_demo_vid', vid) }
    } catch { vid = crypto.randomUUID() }

    fetch(`/api/demos/${slug}/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'view', visitorId: vid }) })
      .then((r) => r.json()).then((j) => { viewId.current = j.viewId || null }).catch(() => {})

    const sendDwell = () => {
      if (!viewId.current) return
      const ms = Date.now() - start.current
      const payload = JSON.stringify({ event: 'dwell', viewId: viewId.current, ms })
      try { navigator.sendBeacon(`/api/demos/${slug}/track`, new Blob([payload], { type: 'application/json' })) }
      catch { fetch(`/api/demos/${slug}/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {}) }
    }
    const onHidden = () => { if (document.visibilityState === 'hidden') sendDwell() }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', sendDwell)
    return () => { document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', sendDwell) }
  }, [slug])

  return null
}
