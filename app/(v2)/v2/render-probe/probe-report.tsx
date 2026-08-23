'use client'

import { useEffect, useRef } from 'react'

// Measurements for the headless harness, written into an inert <script type="application/json">.
//
// It writes into a JSON script node and NOT into a visible element on purpose. The fixture this
// replaces carried a debug <pre> painted fixed over the top of the frame at z-index 99; every
// contrast number taken through it was wrong, and nobody noticed because the overlay looked like part
// of the tooling rather than part of the page. A JSON script node renders nothing, and
// scripts/measure-hero.mjs asserts the frame has nothing painted over it before reading a pixel.
//
// `force` sets data-state on the root so the harness can photograph the listening CSS. It forces the
// STATE ATTRIBUTE ONLY — the voice state machine needs a microphone and a realtime session, so the
// composer keeps its idle label. That is a real limit of this probe, and the harness reports it.

export type ProbeState = 'idle' | 'listening'

const rect = (el: Element | null) => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    top: Math.round(r.top), left: Math.round(r.left),
    width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom),
  }
}

/**
 * Each VISUAL line of the caption, as the browser laid it out.
 *
 * Every character's client rect, grouped by the row it landed in. A visual line is not a text node:
 * rudiLine marks the closing clause accent:true so it becomes its own span, and a row that ends
 * mid-clause spans two nodes. Grouping per node reported the first row twice — once for each node it
 * crossed — which is how a two-line caption came back as three.
 */
function captionLines(el: Element | null) {
  if (!el) return []
  const chars: { top: number; bottom: number; left: number; right: number; ch: string; accent: boolean }[] = []
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent ?? ''
    const parent = n.parentElement
    // The accent clause is painted with a gradient, not the caption's white — a contrast figure that
    // assumes white text is wrong for it, so each row records whether any of it is accented.
    const accent = !!parent && getComputedStyle(parent).webkitTextFillColor === 'rgba(0, 0, 0, 0)'
    for (let i = 0; i < text.length; i++) {
      range.setStart(n, i)
      range.setEnd(n, i + 1)
      const r = range.getBoundingClientRect()
      if (r.height) chars.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, ch: text[i], accent })
    }
  }
  const rows: { top: number; bottom: number; left: number; right: number; text: string; accent: boolean }[] = []
  for (const c of chars) {
    const row = rows.find((r) => Math.abs(r.top - c.top) <= 4)
    if (row) {
      row.bottom = Math.max(row.bottom, c.bottom)
      row.left = Math.min(row.left, c.left)
      row.right = Math.max(row.right, c.right)
      row.text += c.ch
      row.accent = row.accent || c.accent
    } else {
      rows.push({ top: c.top, bottom: c.bottom, left: c.left, right: c.right, text: c.ch, accent: c.accent })
    }
  }
  // left/right are the row's INKED extent, not the paragraph's. A short closing row like "you." is a
  // quarter of the width, and sampling the ground across the full column would report mostly bare
  // backdrop as if it were the ground behind the text.
  return rows
    .sort((a, b) => a.top - b.top)
    .map((l) => ({
      top: Math.round(l.top), bottom: Math.round(l.bottom),
      left: Math.round(l.left), right: Math.round(l.right),
      height: Math.round(l.bottom - l.top), text: l.text.trim(), accent: l.accent,
    }))
}

/**
 * How many pixels the readout canvas actually holds.
 *
 * The cards are canvas-drawn and their alpha is multiplied by the scan's, so "no cards" can mean the
 * layout put them off-frame, the readouts prop is false, or the pair is simply mid-fade. A count read
 * straight off the backing store separates "never drawn" from "drawn faint", which a screenshot
 * threshold cannot.
 */
function paintedPixels(canvas: HTMLCanvasElement) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let n = 0
    let maxAlpha = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) n++
      if (data[i] > maxAlpha) maxAlpha = data[i]
    }
    return { pixels: n, maxAlpha }
  } catch {
    return null
  }
}

/** Anything painted over the frame that is not the screen itself. */
function strayNodes() {
  return Array.from(document.body.children)
    .filter((el) => {
      if (el.id === 'probe-report' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false
      if (el.classList.contains('v2')) return false
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    .map((el) => {
      const r = el.getBoundingClientRect()
      const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''
      return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls} at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
    })
}

export function ProbeReport({ force }: { force: ProbeState }) {
  const cardsPeakRef = useRef(0)

  useEffect(() => {
    const root = document.querySelector('.v2-root') as HTMLElement | null
    if (root && force !== 'idle') {
      // The veil's height is a 0.4s transition, and a headless capture runs on virtual time, which
      // advances timers but does NOT drive CSS transitions. Forcing the attribute alone therefore
      // photographs the idle height for ever — it reported the listening veil as 36% when it is 48%.
      // Suppress the transition so the attribute lands on its end state immediately. This changes
      // when the height arrives, never what it arrives at.
      const freeze = document.createElement('style')
      freeze.id = 'probe-freeze'
      freeze.textContent = '.v2-scrim { transition: none !important; }'
      document.head.appendChild(freeze)
      root.dataset.state = force
    }

    const write = () => {
      const hero = document.querySelector('.v2-hero')
      const scrim = document.querySelector('.v2-scrim')
      const cap = document.querySelector('.v2-cap')
      const cards = document.querySelector('.v2-cards') as HTMLCanvasElement | null
      const talk = document.querySelector('.v2-talk')
      const block = document.querySelector('[data-bottom-block]')
      const heroBox = hero?.getBoundingClientRect()
      const scrimBox = scrim?.getBoundingClientRect()
      const before = cap ? getComputedStyle(cap, '::before') : null

      const report = {
        state: root?.dataset.state ?? null,
        forced: force,
        mode: root?.dataset.mode ?? null,
        dpr: window.devicePixelRatio,
        // chrome-headless-shell reports `reduce` unless told otherwise, and RudiCanvas refuses to
        // start its rAF loop under it (`if (running || reduced || disposed) return`). Every headless
        // capture taken before this was measured on a still frame with no cards, no rings and no
        // scan — the harness aborts on it rather than photographing a screen nobody sees.
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        hero: rect(hero),
        scrim: rect(scrim),
        scrimPct: heroBox && scrimBox ? +((scrimBox.height / heroBox.height) * 100).toFixed(2) : null,
        scrimBackground: scrim ? getComputedStyle(scrim).backgroundImage : null,
        scrimTransition: scrim ? getComputedStyle(scrim).transitionProperty : null,
        caption: rect(cap),
        captionLines: captionLines(cap),
        capBefore: before
          ? { background: before.backgroundImage, filter: before.filter, inset: before.inset, z: before.zIndex }
          : null,
        cardsCanvas: cards
          ? { ...rect(cards), bufferW: cards.width, bufferH: cards.height, painted: paintedPixels(cards), peakPainted: cardsPeakRef.current }
          : null,
        bottomBlock: rect(block),
        talk: talk
          ? { ...rect(talk), label: (talk.textContent ?? '').replace(/\s+/g, ' ').trim(), on: talk.hasAttribute('data-on') }
          : null,
        // The swipe handle and its label. Both are white at low alpha, so what sits behind them is
        // the whole question once the veil is gone.
        grab: (() => {
          const bar = document.querySelector('.v2-grab s')
          const label = document.querySelector('.v2-grab span')
          return {
            bar: bar ? { ...rect(bar), background: getComputedStyle(bar).backgroundColor } : null,
            label: label ? { ...rect(label), color: getComputedStyle(label).color, text: label.textContent } : null,
          }
        })(),
        strayNodes: strayNodes(),
      }

      let node = document.getElementById('probe-report')
      if (!node) {
        node = document.createElement('script')
        node.id = 'probe-report'
        node.setAttribute('type', 'application/json')
        document.body.appendChild(node)
      }
      node.textContent = JSON.stringify(report)
      document.documentElement.setAttribute('data-probe-ready', '1')
    }

    // The readout cards fade in and out on a 5.25s cycle and their alpha is multiplied by the scan's,
    // so a single sample cannot tell "never drew" from "caught mid-fade". Watch the canvas across a
    // whole cycle and keep the busiest frame seen; the harness asserts against the PEAK, not against
    // whatever instant the screenshot happened to land on.
    let peak = 0
    const cardsEl = () => document.querySelector('.v2-cards') as HTMLCanvasElement | null
    const watch = setInterval(() => {
      const c = cardsEl()
      const p = c ? paintedPixels(c) : null
      if (p && p.pixels > peak) peak = p.pixels
      cardsPeakRef.current = peak
    }, 100)
    const stopWatch = setTimeout(() => clearInterval(watch), 6000)

    // After paint, and again once fonts have settled — a caption measured against a fallback face
    // wraps to different line boxes than the one that ships.
    const raf = requestAnimationFrame(() => requestAnimationFrame(write))
    document.fonts?.ready.then(() => setTimeout(write, 150))
    const late = setInterval(write, 500)
    const stopLate = setTimeout(() => clearInterval(late), 9000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(watch); clearTimeout(stopWatch)
      clearInterval(late); clearTimeout(stopLate)
    }
  }, [force])

  return null
}
