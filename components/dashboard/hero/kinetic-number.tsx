'use client'

import { useEffect, useRef, useState } from 'react'

// B4 — the giant kinetic hero number. Counts up from 0 on mount (~1.1s ease-out cubic, rAF),
// and on a live increase does a quick scale pop (1 → 1.12 → 1). Always ends on the exact value.
// Respects prefers-reduced-motion (jumps to the value; no pop).
export function KineticNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(value)
  const [pop, setPop] = useState(0)
  const prev = useRef(value)
  const mounted = useRef(false)

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const from = mounted.current ? prev.current : 0
    const increased = mounted.current && value > prev.current
    mounted.current = true
    prev.current = value
    if (increased) setPop((p) => p + 1)
    if (reduce || value === from) { setDisplay(value); return }
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1100)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return <span key={pop} className={`inline-block${pop ? ' sx-pop' : ''}`}>{display.toLocaleString()}{suffix}</span>
}
