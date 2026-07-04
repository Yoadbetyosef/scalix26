'use client'

import { useEffect, useState } from 'react'

// TEMPORARY mobile overflow diagnostic. Self-gating: runs only in dev, or on any build when the
// URL has `?__overflow=1` (so it works on the preview deploy without devtools). Finds every
// element whose box extends past the viewport, logs it to the console AND shows an on-screen
// panel so you can spot the real overflow source on a phone. Remove after the hardening pass.
export function OverflowDiagnostic() {
  const [on, setOn] = useState(false)
  const [hits, setHits] = useState<string[]>([])
  const [dims, setDims] = useState({ vw: 0, sw: 0 })

  useEffect(() => {
    const active = process.env.NODE_ENV !== 'production' || new URLSearchParams(window.location.search).has('__overflow')
    if (!active) return
    setOn(true)
    const scan = () => {
      const vw = window.innerWidth
      const found: string[] = []
      document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return
        if (r.right > vw + 1 || r.left < -1) {
          const cls = typeof el.className === 'string' ? el.className.trim().replace(/\s+/g, '.').slice(0, 70) : ''
          found.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} → ${Math.round(r.left)}…${Math.round(r.right)}`)
          // eslint-disable-next-line no-console
          console.warn('[overflow]', Math.round(r.right), el)
        }
      })
      const sw = document.documentElement.scrollWidth
      // eslint-disable-next-line no-console
      console.warn(`[overflow] scrollWidth=${sw} innerWidth=${vw} offenders=${found.length}`)
      setDims({ vw, sw })
      setHits(found.slice(0, 15))
    }
    const t = setTimeout(scan, 700)
    window.addEventListener('resize', scan)
    window.addEventListener('orientationchange', scan)
    return () => { clearTimeout(t); window.removeEventListener('resize', scan); window.removeEventListener('orientationchange', scan) }
  }, [])

  if (!on) return null
  const dragging = dims.sw > dims.vw
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 2147483647, maxHeight: '42vh', overflow: 'auto', background: 'rgba(8,11,26,0.95)', color: '#fff', font: '11px/1.45 ui-monospace, monospace', padding: '8px 10px', WebkitBackdropFilter: 'blur(4px)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: dragging ? '#ff6b6b' : '#51cf66' }}>
        {dragging ? '❌ HORIZONTAL DRAG' : '✅ locked'} · scrollWidth={dims.sw} innerWidth={dims.vw} · {hits.length} offenders
      </div>
      {hits.length === 0 ? <div style={{ opacity: 0.7 }}>No elements exceed the viewport.</div> : hits.map((h, i) => <div key={i} style={{ wordBreak: 'break-all', opacity: 0.9 }}>• {h}</div>)}
    </div>
  )
}
