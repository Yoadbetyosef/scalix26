'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Numbers that count up on mount — the proof of work animating into place. Uses rAF
 * (no layout thrash), eases out, and respects prefers-reduced-motion (jumps straight
 * to the final value). Renders the final value on the server to avoid a hydration gap.
 */
export function CountUp({
  value,
  suffix = '',
  duration = 900,
  className,
}: {
  value: number
  suffix?: string
  duration?: number
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const mounted = useRef(false)

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const from = mounted.current ? display : 0
    mounted.current = true
    if (reduce || value === from) { setDisplay(value); return }

    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])

  return <span className={className}>{display.toLocaleString()}{suffix}</span>
}
