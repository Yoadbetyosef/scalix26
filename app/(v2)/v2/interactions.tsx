'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// The interaction layer: magnetic pull on the Talk button, the custom cursor over the media, and the
// ⌘K palette. All three are pointer/keyboard behaviour with no data of their own, so they live
// together rather than being scattered through the components they decorate.
//
// Every one of them is desktop-only and pointer-only, and every one is disabled under reduced motion.

const REDUCED = () => typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ── Magnetic button ─────────────────────────────────────────────────────────────────────────────────
//
// Within RADIUS of the button's centre it translates toward the pointer at STRENGTH, and the label,
// mic and keycap inside follow at 42% of that — so the pill leads and the words catch up. Vertical
// pull is 80% of horizontal, which keeps it feeling like a control on a rail rather than a balloon.
//
// The gradient's origin follows the pointer through --gx/--gy, which is why the button's fill is a
// radial-gradient with custom-property stops rather than a fixed linear one.

const RADIUS = 150
const STRENGTH = 0.3
const INNER_LAG = 0.42

export function useMagnet(el: HTMLButtonElement | null, disabled = false) {
  useEffect(() => {
    if (!el || disabled || REDUCED()) return
    if (!window.matchMedia('(pointer: fine)').matches) return

    let raf = 0
    let magnetised = false

    const inner = () => Array.from(el.querySelectorAll<HTMLElement>('.v2-lab, .v2-mic, .v2-kbd'))

    const apply = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      const dx = e.clientX - (r.left + r.width / 2)
      const dy = e.clientY - (r.top + r.height / 2)
      const dist = Math.hypot(dx, dy)

      if (dist < RADIUS) {
        const f = 1 - dist / RADIUS
        magnetised = true
        el.dataset.mag = 'true'
        el.style.transform = `translate(${dx * STRENGTH * f}px,${dy * STRENGTH * f * 0.8}px)`
        for (const c of inner()) {
          c.style.transform = `translate(${dx * STRENGTH * f * INNER_LAG}px,${dy * STRENGTH * f * 0.3}px)`
        }
        el.style.setProperty('--gx', `${((e.clientX - r.left) / r.width * 100).toFixed(1)}%`)
        el.style.setProperty('--gy', `${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`)
      } else if (magnetised) {
        magnetised = false
        // Removing the flag restores the long settle curve, so it eases home rather than snapping.
        delete el.dataset.mag
        el.style.transform = ''
        for (const c of inner()) c.style.transform = ''
        el.style.setProperty('--gx', '50%')
        el.style.setProperty('--gy', '50%')
      }
    }

    // One apply per frame. Without this the handler runs per mousemove event, which on a fast pointer
    // is several times a frame and does the same layout work repeatedly.
    const onMove = (e: MouseEvent) => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; apply(e) })
    }

    // Press settles to 0.952 and release overshoots to 1.03 before coming to rest.
    const onDown = () => { el.dataset.down = 'true' }
    const onUp = () => {
      if (!el.dataset.down) return
      delete el.dataset.down
      delete el.dataset.pop
      void el.offsetWidth // reflow, so the animation restarts on a repeat press
      el.dataset.pop = 'true'
      setTimeout(() => { delete el.dataset.pop }, 560)
    }

    window.addEventListener('mousemove', onMove)
    el.addEventListener('mousedown', onDown)
    el.addEventListener('mouseup', onUp)
    el.addEventListener('mouseleave', onUp)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      el.removeEventListener('mousedown', onDown)
      el.removeEventListener('mouseup', onUp)
      el.removeEventListener('mouseleave', onUp)
    }
  }, [el, disabled])
}

// ── Custom cursor ───────────────────────────────────────────────────────────────────────────────────
//
// A ring that follows the pointer at 22% per frame — the lag is the point — and swells to 84px with a
// TALK / STOP / EXPAND label ONLY over the media. Everywhere else it is hidden and the native cursor
// is back, which is why `cursor: none` is set on .v2-face alone and not on the shell.

export function Cursor({ label, active }: { label: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)

  useEffect(() => {
    if (REDUCED() || !window.matchMedia('(pointer: fine)').matches) return
    const node = ref.current
    if (!node) return

    let x = 0, y = 0, tx = 0, ty = 0
    let raf = requestAnimationFrame(function follow() {
      x += (tx - x) * 0.22
      y += (ty - y) * 0.22
      node.style.left = `${x}px`
      node.style.top = `${y}px`
      raf = requestAnimationFrame(follow)
    })

    const onMove = (e: MouseEvent) => {
      tx = e.clientX; ty = e.clientY
      const t = e.target as HTMLElement | null
      setOver(!!t && t.tagName === 'CANVAS')
    }
    window.addEventListener('mousemove', onMove)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('mousemove', onMove) }
  }, [])

  return (
    <div ref={ref} className="v2-cur" data-on={(over && active) || undefined} aria-hidden>
      <em>{label}</em>
    </div>
  )
}

// ── Command palette ─────────────────────────────────────────────────────────────────────────────────

export interface Command { label: string; hint?: string }

export function Palette(props: { commands: Command[]; open: boolean; onClose: () => void }) {
  // Remounted per open, so its query and selection reset by construction rather than by an effect
  // that writes state on a prop change.
  return props.open ? <PaletteBox key="open" {...props} /> : null
}

function PaletteBox({ commands, onClose }: { commands: Command[]; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const hits = commands.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()))

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'ArrowDown') { e.preventDefault(); setI((p) => Math.min(hits.length - 1, p + 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setI((p) => Math.max(0, p - 1)) }
      // Enter selects, and does nothing else: /v2 navigates nowhere and writes nothing.
      if (e.key === 'Enter') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hits.length, onClose])

  return (
    <div className="v2-pal" onClick={onClose} role="dialog" aria-modal aria-label="Command palette">
      <div className="v2-palbox" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setI(0) }}
          placeholder="Search sections, leads, settings…"
          autoComplete="off"
          aria-label="Search"
        />
        <div className="v2-pallist">
          {hits.length === 0
            ? <p className="v2-palempty">Nothing matches “{q}”.</p>
            : hits.map((c, n) => (
              <div key={c.label} className="v2-palrow" data-on={n === i || undefined} onMouseEnter={() => setI(n)}>
                <span>{c.label}</span>
                {c.hint && <em>{c.hint}</em>}
              </div>
            ))}
        </div>
        <div className="v2-palfoot">
          <span>↑↓ navigate</span><span>⏎ open</span><span>esc close</span>
        </div>
      </div>
    </div>
  )
}

/** ⌘K / Ctrl-K, and Esc to go home. Returns the open state and a setter. */
export function usePalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const close = useCallback(() => setOpen(false), [])
  return { open, setOpen, close }
}
