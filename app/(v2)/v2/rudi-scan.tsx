'use client'

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { PERSONAS, portraitOf, type PersonaKey } from '@/lib/persona'
import type { RudiHandle, RudiState, Props } from './rudi-canvas'

// THE SCAN — docs/miles/rudi-scan-v26.html, reproduced.
//
// The resting state: what she does while she waits. Every number below is the reference's own, and
// where one looks arbitrary it is because it was chosen by eye in that file and copied here rather
// than re-derived.
//
// ── THE PORTRAIT IS NOT ON THE CANVAS ANY MORE ──────────────────────────────────────────────────
//
// This is the structural difference from the old loop, and everything else follows from it. There,
// the canvas WAS the portrait — drawImage for eighteen displaced slices, the breath, the speaking
// video, all composited by hand, which is why that file carries IW/IH constants and a crop bias.
//
// Here the portrait is an <img> and the speaking clip is a <video>, both underneath a transparent
// canvas that draws only the scan. That is what the reference does, and it is better for three
// reasons that are not about taste: `object-fit: cover` is the browser's crop rather than ours, the
// video crossfade becomes an opacity transition the compositor runs off the main thread, and the
// still paints on the first frame instead of waiting for a decode inside a rAF.
//
// It also means the assets are no longer 680×907. They are 784×1660 — the ratio of the phone frame
// itself, so `cover` neither crops nor letterboxes.
//
// ── THE SCAN STOPS WHILE SHE IS SPEAKING ────────────────────────────────────────────────────────
//
// A scan is what she does while WAITING. The old loop already held this rule — "the video crossfading
// in while speaking with no scan and no overlay at all" — and it survives unchanged: the sequence
// fades out over ~200ms, the clip fades in, and the phase readout goes quiet.
//
// ── WHAT THE REFERENCE DOES NOT SPECIFY ─────────────────────────────────────────────────────────
//
// It is the RESTING state only. There is no listening treatment in it and no armed one, so those two
// keep the scan running rather than inheriting a look nobody drew. The level meter the old loop
// painted has no counterpart here either — `level()` stays on the handle because callers drive it,
// and it moves nothing on this screen. Both are gaps in the reference, not decisions made here.

/** The reference's own layout constants. */
const CYCLE = 5.4
const CARD_CYCLE = 5.25
/**
 * The fraction of height the readouts must not pass, so the copy underneath is never covered.
 *
 * THE REFERENCE'S 0.660 IS THE FALLBACK, NOT THE RULE. It was measured against one sentence at one
 * width in a 392×830 frame. On a real phone the caption is whatever Rudi has to say — "1 job on the
 * books today" wraps to two lines on a narrow screen — and the block underneath grows upward past a
 * fixed fraction, which is how CALLS TODAY ended up sitting on top of the sentence and ANSWERED
 * covering the end of the line.
 *
 * So the ceiling is MEASURED from the element the cards must clear, and this number is only what it
 * falls back to when there is nothing to measure — a desktop hero, or a first frame before layout.
 */
const CEILING_FALLBACK = 0.66

/**
 * How far the right-hand card hangs below the left one, as a fraction of height.
 *
 * Shared by the drawing and the ceiling deliberately: the LOWER card is the one that has to clear the
 * copy, so a ceiling computed without this would leave exactly one of the two overlapping — which is
 * the half-fixed version of this bug and harder to see than the whole one.
 */
const CARD_DROP = 0.055

/** Clear air between the lowest card and the top of the block, as a fraction of height. */
const CARD_GAP = 0.02

const MARK: Array<{ x: number; y: number; t: string; c: string }> = [
  { x: 0.26, y: 0.13, t: 'V·004', c: '34,211,238' }, { x: 0.70, y: 0.10, t: 'C·012', c: '255,46,147' },
  { x: 0.18, y: 0.28, t: 'A·007', c: '139,92,246' }, { x: 0.78, y: 0.25, t: 'V·019', c: '34,211,238' },
  { x: 0.40, y: 0.38, t: 'C·003', c: '255,46,147' }, { x: 0.64, y: 0.42, t: 'A·021', c: '139,92,246' },
  { x: 0.30, y: 0.50, t: 'V·031', c: '34,211,238' }, { x: 0.72, y: 0.54, t: 'C·028', c: '255,46,147' },
]
const HEAT = [{ x: 0.30, y: 0.34, r: 0.22 }, { x: 0.68, y: 0.28, r: 0.19 }, { x: 0.48, y: 0.46, r: 0.17 }]
const PHASES: Array<[number, string, string]> = [
  [0, '1', 'ANALYSIS'], [0.24, '2', 'READING'], [0.44, '3', 'THE INBOX'],
  [0.62, '4', 'THE DIARY'], [0.82, '5', 'ON DUTY'],
]
const CARDS: Array<Array<[string, string]>> = [
  [['CALLS TODAY', '3'], ['ANSWERED', '100%']],
  [['WAITING ON YOU', '1'], ['BOOKED', '1']],
  [['AFTER HOURS', '6'], ['AVG CALL', '1m 21s']],
]

export function RudiScan({ handleRef, onStateChange, minimised = false, className, onClick, persona = 'rudi' }: Props) {
  const p = PERSONAS[persona as PersonaKey] ?? PERSONAS.rudi
  const STILL = portraitOf(p)
  const VIDEO = p.video

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardsRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const phaseNoRef = useRef<HTMLSpanElement>(null)
  const phaseNameRef = useRef<HTMLSpanElement>(null)
  const [state, setStateRaw] = useState<RudiState>('idle')

  // Everything the loop touches lives in a ref: a re-subscribe on every level update would stutter
  // the animation, which is the same reason the old loop kept its state here.
  const stateRef = useRef<RudiState>('idle')
  const levelRef = useRef<number | null>(null)
  const speakEndRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const minRef = useRef(minimised)
  useEffect(() => { minRef.current = minimised }, [minimised])

  const setState = useCallback((s: RudiState) => {
    const from = stateRef.current
    if (from === s) return
    console.info(`[v2 state] ${Math.round(performance.now())}ms ${from} -> ${s}`)
    stateRef.current = s
    setStateRaw(s)
    onStateChange?.(s)
  }, [onStateChange])

  // ── The control surface ─────────────────────────────────────────────────────────────────────────
  // The same shape the old loop exposes, so nothing that drives her has to know which one is mounted.
  useImperativeHandle(handleRef, (): RudiHandle => ({
    speak(text?: string, ms?: number) {
      const v = videoRef.current
      // preload="none", so the bytes are not requested until something asks. Idempotent.
      if (v && v.readyState < 2) { try { v.load() } catch { /* the still is the fallback */ } }
      speakEndRef.current = performance.now() + (ms ?? 6000)
      if (stateRef.current !== 'speaking') setState('speaking')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (stateRef.current === 'speaking') setState('idle')
      }, Math.max(300, speakEndRef.current - performance.now()))
    },
    stopSpeaking() {
      speakEndRef.current = 0
      if (timerRef.current) clearTimeout(timerRef.current)
      if (stateRef.current === 'speaking') setState('idle')
    },
    listen() { if (stateRef.current !== 'listening') setState('listening') },
    stopListening() { if (stateRef.current === 'listening') setState('idle') },
    arm() { if (stateRef.current !== 'armed') setState('armed') },
    // The old loop restarted its sweep from here. The scan runs on its own clock and has no phase to
    // reset, so this is deliberately inert rather than removed — callers still call it.
    scan() { /* no phase to restart: the sequence is continuous */ },
    endSession() {
      if (timerRef.current) clearTimeout(timerRef.current)
      speakEndRef.current = 0
      levelRef.current = null
      setState('idle')
    },
    level(v: number) { levelRef.current = Math.min(1, Math.max(0, v)) },
    state() { return stateRef.current },
  }), [setState])

  // ── The clip ────────────────────────────────────────────────────────────────────────────────────
  // Play and pause follow the state rather than the loop, because the element is composited by the
  // browser now and nothing samples it. A play() rejection is not an error worth surfacing: autoplay
  // policy refusing a muted inline video leaves the still on screen, which is the fallback anyway.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (state === 'speaking') { v.play().catch(() => {}) } else { try { v.pause() } catch { /* not fatal */ } }
  }, [state])

  // ── The scan ────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const cardsCanvas = cardsRef.current
    if (!canvas || !cardsCanvas) return
    const ctx = canvas.getContext('2d')
    // ── WHY THE READOUTS GET THEIR OWN CANVAS ─────────────────────────────────────────────────────
    //
    // They were painted onto the scan's canvas at z-index 5, and the veil that darkens the foot of
    // the frame sits at 9 — so the gradient fell ACROSS them, and the lower a card sat the more it
    // was dimmed. On an acid card that reads as a shadow, and they are the one element on this screen
    // that has to stay legible.
    //
    // They are chrome, not part of the sequence. The scan belongs under the veil and stays there.
    //
    // A second canvas rather than DOM, because DOM would mean re-deriving every position: the card
    // widths come from ctx.measureText on canvas-pixel fonts, and x, y, the corner radius and the
    // drop are all fractions of the backing store. This canvas shares the parent box and the same DPR
    // expression, so W and H are identical to the scan's and not one coordinate changes.
    const cctx = cardsCanvas.getContext('2d')
    if (!ctx || !cctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let disposed = false
    let W = 0, H = 0
    let t = 0, ct = 0
    let last = performance.now()
    // The scan's own opacity, so stopping for a speech is a fade rather than a cut.
    let scanA = 1
    let phaseKey = ''
    // Where the cards may reach. Recomputed on layout, never per frame — getBoundingClientRect is a
    // layout read, and sixty of them a second to answer a question that changes when the text wraps
    // is the kind of thing that makes a canvas feel expensive.
    let ceiling = CEILING_FALLBACK

    /**
     * Measure the block the readouts must stay above.
     *
     * Both rects come from the same viewport, so the subtraction is in CSS pixels and the ratio is
     * the same in canvas pixels — no DPR term, and none wanted: a fraction is a fraction.
     */
    function measureCeiling() {
      const block = canvas!.closest('.v2-hero')?.querySelector('[data-bottom-block]')
      if (!block) { ceiling = CEILING_FALLBACK; return }
      const cr = canvas!.getBoundingClientRect()
      const br = block.getBoundingClientRect()
      if (!cr.height || !br.height) return
      const top = (br.top - cr.top) / cr.height
      // The lowest card is the dropped one, so that is what has to clear the block.
      const want = top - CARD_DROP - CARD_GAP
      // Never above the top third: a ceiling that high would mean the copy has eaten the screen, and
      // cards floating by her forehead is a worse answer than cards that are simply not shown.
      ceiling = Math.max(0.30, Math.min(CEILING_FALLBACK, want))
    }

    // ASSIGNING canvas.width WIPES THE CANVAS — and resets the 2D context — even when the value is
    // unchanged. The old loop learned this the hard way (a mouse move blanked the screen), so measure
    // first and only resize on a genuine change.
    function fit() {
      const r = canvas!.getBoundingClientRect()
      const d = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.round(r.width * d), h = Math.round(r.height * d)
      if (!w || !h || (w === W && h === H)) return
      W = w; H = h
      canvas!.width = W; canvas!.height = H
      // Same dimensions from the same measurement — the two layers cannot disagree about the frame.
      cardsCanvas!.width = W; cardsCanvas!.height = H
      measureCeiling()
    }

    const seg = (a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)))
    const eo = (k: number) => 1 - Math.pow(1 - k, 3)

    /** Used by the readouts only, so it draws into their context rather than the scan's. */
    function rr(x: number, y: number, w: number, h: number, r: number) {
      cctx!.beginPath()
      cctx!.moveTo(x + r, y)
      cctx!.arcTo(x + w, y, x + w, y + h, r)
      cctx!.arcTo(x + w, y + h, x, y + h, r)
      cctx!.arcTo(x, y + h, x, y, r)
      cctx!.arcTo(x, y, x + w, y, r)
      cctx!.closePath()
    }

    // ── The readouts ──────────────────────────────────────────────────────────────────────────────
    // On their OWN clock — 5.25s against the scan's 5.4 — so the pairs drift against the sequence
    // instead of arriving with it, and a 3.4s hold is long enough to read twice.
    function cards() {
      const per = 1 / CARDS.length
      const local = (ct % per) / per
      const idx = Math.floor(ct / per)
      let a: number
      if (local < 0.09) a = local / 0.09
      else if (local < 0.77) a = 1
      else a = 1 - (local - 0.77) / 0.23
      a *= scanA
      if (a <= 0.01) return

      const set = CARDS[idx % CARDS.length]
      const kf = `500 ${W * 0.019}px "JetBrains Mono", ui-monospace, monospace`
      const vf = `500 ${W * 0.068}px "Inter Tight", system-ui, sans-serif`
      const padX = W * 0.028, padY = H * 0.012, lead = H * 0.030
      const cs = set.map((s) => {
        cctx!.font = kf; const kw = cctx!.measureText(s[0]).width
        cctx!.font = vf; const vw = cctx!.measureText(s[1]).width
        return { k: s[0], v: s[1], w: Math.max(kw, vw) + padX * 2 }
      })
      const hh = padY * 2 + lead + W * 0.040
      const y = H * ceiling - hh
      const rise = (1 - a) * H * 0.012
      const margin = W * 0.056
      cs.forEach((cd, i) => {
        const x = i === 0 ? margin : W - margin - cd.w
        const drop = i === 1 ? H * CARD_DROP : 0
        cctx!.fillStyle = `rgba(217,242,36,${a * 0.92})`
        rr(x, y + rise + drop, cd.w, hh, W * 0.013); cctx!.fill()
        cctx!.fillStyle = `rgba(65,73,10,${a * 0.78})`; cctx!.font = kf
        cctx!.fillText(cd.k, x + padX, y + rise + drop + padY + W * 0.016)
        cctx!.fillStyle = `rgba(24,28,4,${a})`; cctx!.font = vf
        cctx!.fillText(cd.v, x + padX, y + rise + drop + padY + lead + W * 0.040)
      })
    }

    function frame() {
      if (disposed) return
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      // NOT fit() — that reads getBoundingClientRect, and a layout read every frame is a cost paid
      // sixty times a second to answer a question that only changes when something resizes. The
      // ResizeObserver below is what answers it, which is where the old loop put it too.
      if (!W || !H) { raf = requestAnimationFrame(frame); return }

      // Speaking is the one state that stops the sequence. The clock keeps running underneath so the
      // scan resumes mid-stride rather than restarting at the centre line.
      const wanted = stateRef.current === 'speaking' ? 0 : 1
      scanA += (wanted - scanA) * Math.min(1, dt * 8)
      if (scanA < 0.003) scanA = 0

      t = (t + dt / CYCLE) % 1
      ct = (ct + dt / CARD_CYCLE) % 1
      ctx!.clearRect(0, 0, W, H)
      // Cleared on the same frame as the scan, and before the early return below — a layer that kept
      // its last frame would leave two readouts hanging over her while she speaks.
      cctx!.clearRect(0, 0, W, H)

      if (scanA <= 0) { raf = requestAnimationFrame(frame); return }

      const cx = W / 2, cy = H * 0.34
      const A = (t > 0.92 ? 1 - seg(0.92, 1) : 1) * scanA
      const open = eo(seg(0.04, 0.24))
      const L = cx - cx * open, R = cx + cx * open

      // The centre line, before the box opens.
      if (t < 0.04) {
        ctx!.strokeStyle = `rgba(255,255,255,${0.55 * scanA})`
        ctx!.lineWidth = 2
        ctx!.beginPath(); ctx!.moveTo(cx, 0); ctx!.lineTo(cx, H); ctx!.stroke()
        cards()
        raf = requestAnimationFrame(frame)
        return
      }

      ctx!.save()
      ctx!.beginPath(); ctx!.rect(L, 0, R - L, H); ctx!.clip()

      // The wireframe: a warped surface, not a sphere — the horizontal term leans with `u` so it
      // reads as something wrapped around her rather than a globe in front of her.
      const wfA = A * seg(0.12, 0.32) * (1 - seg(0.42, 0.60) * 0.55) * 0.34
      if (wfA > 0.008) {
        const rx = W * 0.66, ry = H * 0.60
        const wx = (u: number, v: number) => cx + Math.sin(u * Math.PI / 2) * rx * Math.sqrt(Math.max(0, 1 - v * v * 0.40))
        const wy = (u: number, v: number) => cy + v * ry + (1 - Math.cos(u * Math.PI / 2)) * ry * 0.08 * (v < 0 ? -1 : 1)
        const COLS = 16, ROWS = 22
        ctx!.strokeStyle = `rgba(255,255,255,${wfA})`; ctx!.lineWidth = 1
        for (let i = 0; i <= COLS; i++) {
          const u = -1 + 2 * i / COLS
          ctx!.beginPath()
          for (let j = 0; j <= ROWS; j++) {
            const v = -1 + 2 * j / ROWS
            const X = wx(u, v), Y = wy(u, v)
            j ? ctx!.lineTo(X, Y) : ctx!.moveTo(X, Y)
          }
          ctx!.stroke()
        }
        for (let j = 0; j <= ROWS; j++) {
          const v = -1 + 2 * j / ROWS
          ctx!.beginPath()
          for (let i = 0; i <= COLS * 2; i++) {
            const u = -1 + 2 * i / (COLS * 2)
            const X = wx(u, v), Y = wy(u, v)
            i ? ctx!.lineTo(X, Y) : ctx!.moveTo(X, Y)
          }
          ctx!.stroke()
        }
      }

      // The square grid, tinted magenta → cyan across x. The ramp is the product's, left where the
      // reference put it: horizontally across the frame rather than banded by height.
      const sqA = A * seg(0.16, 0.34) * (1 - seg(0.46, 0.64) * 0.5)
      if (sqA > 0.008) {
        const S = W * 0.040, q = W * 0.011
        for (let x = S / 2; x < W; x += S) {
          for (let y = S / 2; y < H; y += S) {
            const f = 1 - Math.min(1, Math.hypot((x - cx) / (W * 0.78), (y - cy) / (H * 0.78))) * 0.5
            const gx = x / W
            ctx!.fillStyle = `rgba(${Math.round(255 - 221 * gx)},${Math.round(46 + 165 * gx)},${Math.round(147 + 91 * gx)},${sqA * f * 0.42})`
            ctx!.fillRect(x - q / 2, y - q / 2, q, q)
          }
        }
      }

      // Heat, breathing at its own rate per bloom.
      const htA = A * seg(0.36, 0.54) * (t > 0.88 ? 1 - seg(0.88, 0.96) : 1)
      if (htA > 0.008) {
        HEAT.forEach((h, i) => {
          const hx = h.x * W, hy = h.y * H, hr = h.r * W * (0.87 + 0.13 * Math.sin(t * 20 + i))
          const g = ctx!.createRadialGradient(hx, hy, 0, hx, hy, hr)
          g.addColorStop(0, `rgba(255,46,147,${htA * 0.24})`)
          g.addColorStop(0.5, `rgba(139,92,246,${htA * 0.12})`)
          g.addColorStop(1, 'rgba(139,92,246,0)')
          ctx!.fillStyle = g
          ctx!.beginPath(); ctx!.arc(hx, hy, hr, 0, 7); ctx!.fill()
        })
      }

      ctx!.restore()

      // The tick ring: a true circle around her head, in acid, half a turn per cycle. Outside the
      // clip on purpose — it reads as instrumentation over the whole frame rather than something
      // inside the box.
      const rgA = A * seg(0.30, 0.48) * (t > 0.90 ? 1 - seg(0.90, 0.98) : 1)
      if (rgA > 0.008) {
        const hx = W * 0.50, hy = H * 0.355
        const RAD = W * 0.52
        const TICKS = 96
        const STEP = Math.PI * 2 / TICKS
        const spin = t * Math.PI * 2 * 0.5
        const len = W * 0.024
        ctx!.lineWidth = W * 0.0020
        ctx!.lineCap = 'round'
        for (let i = 0; i < TICKS; i++) {
          const ang = i * STEP + spin
          // The ring arrives tick by tick rather than fading in as a whole.
          const on = Math.max(0, Math.min(1, rgA * 1.8 * TICKS - i))
          if (on <= 0) continue
          const ex = Math.cos(ang), ey = Math.sin(ang)
          ctx!.strokeStyle = `rgba(217,242,36,${on * 0.72})`
          ctx!.beginPath()
          ctx!.moveTo(hx + ex * RAD, hy + ey * RAD)
          ctx!.lineTo(hx + ex * (RAD + len), hy + ey * (RAD + len))
          ctx!.stroke()
        }
        ctx!.lineCap = 'butt'
      }

      // Markers, then their labels a beat later.
      const mkA = A * seg(0.48, 0.62), lbA = A * seg(0.60, 0.76)
      if (mkA > 0.008) {
        ctx!.font = `500 ${W * 0.024}px "JetBrains Mono", ui-monospace, monospace`
        MARK.forEach((m, i) => {
          const on = Math.max(0, Math.min(1, mkA * MARK.length - i * 0.6))
          if (on <= 0) return
          const x = m.x * W, y = m.y * H, s = W * 0.020
          ctx!.strokeStyle = `rgba(${m.c},${on * 0.75})`
          ctx!.lineWidth = 1.5
          ctx!.strokeRect(x - s / 2, y - s / 2, s, s)
          if (lbA > 0.02) {
            const lo = Math.max(0, Math.min(1, lbA * MARK.length - i * 0.6))
            ctx!.fillStyle = `rgba(${m.c},${lo * 0.75})`
            ctx!.fillText(m.t, x - s / 2, y + s * 1.7)
          }
        })
      }

      // The crosshair, on one marker only — the fifth. A scan that settled on everything would be
      // saying it had found nothing in particular.
      const chA = A * seg(0.66, 0.80) * (t > 0.90 ? 1 - seg(0.90, 0.98) : 1)
      if (chA > 0.008) {
        const tg = MARK[4], x = tg.x * W, y = tg.y * H, r = W * 0.055
        ctx!.strokeStyle = `rgba(255,255,255,${chA * 0.6})`
        ctx!.lineWidth = 1.2
        ctx!.beginPath(); ctx!.arc(x, y, r, 0, 7); ctx!.stroke()
        ctx!.beginPath()
        ctx!.moveTo(x - r * 1.6, y); ctx!.lineTo(x - r * 0.6, y)
        ctx!.moveTo(x + r * 0.6, y); ctx!.lineTo(x + r * 1.6, y)
        ctx!.moveTo(x, y - r * 1.6); ctx!.lineTo(x, y - r * 0.6)
        ctx!.moveTo(x, y + r * 0.6); ctx!.lineTo(x, y + r * 1.6)
        ctx!.stroke()
      }

      // The two edges of the box.
      const edA = A * Math.min(1, seg(0.04, 0.18))
      ctx!.strokeStyle = `rgba(255,255,255,${edA * 0.5})`
      ctx!.lineWidth = 1.6
      ctx!.beginPath()
      ctx!.moveTo(L, 0); ctx!.lineTo(L, H)
      ctx!.moveTo(R, 0); ctx!.lineTo(R, H)
      ctx!.stroke()

      // ERASE the scan out of the lower band rather than trusting the veil to hide it. A pale grid
      // line survives a 55%-black gradient as a visible stripe across the copy.
      const fadeGrad = ctx!.createLinearGradient(0, H * 0.50, 0, H * 0.74)
      fadeGrad.addColorStop(0, 'rgba(0,0,0,0)')
      fadeGrad.addColorStop(1, 'rgba(0,0,0,1)')
      ctx!.globalCompositeOperation = 'destination-out'
      ctx!.fillStyle = fadeGrad
      ctx!.fillRect(0, H * 0.50, W, H * 0.50)
      ctx!.globalCompositeOperation = 'source-over'

      cards()

      // The phase readout is DOM, written only when it changes — a text node touched every frame is
      // a layout invalidation sixty times a second for a string that changes five times a cycle.
      let ph = PHASES[0]
      for (const q of PHASES) if (t >= q[0]) ph = q
      if (phaseKey !== ph[1]) {
        phaseKey = ph[1]
        if (phaseNoRef.current) phaseNoRef.current.textContent = ph[1]
        if (phaseNameRef.current) phaseNameRef.current.textContent = ph[2]
      }

      raf = requestAnimationFrame(frame)
    }

    // Reduced motion gets the portrait and nothing else — the whole sequence is motion, so there is
    // no slower version of it that is still the thing.
    if (!reduced) {
      fit()
      raf = requestAnimationFrame(frame)
    }

    const ro = new ResizeObserver(() => fit())
    ro.observe(canvas)

    // The BLOCK's own size, watched separately from the canvas's. The canvas does not change when the
    // caption wraps to a second line — the block does, and that is the whole case this exists for.
    const block = canvas.closest('.v2-hero')?.querySelector('[data-bottom-block]')
    const bro = block ? new ResizeObserver(() => measureCeiling()) : null
    if (block && bro) bro.observe(block)
    measureCeiling()
    const onVisibility = () => { last = performance.now() }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      bro?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const speaking = state === 'speaking'

  return (
    <div className={className} onClick={onClick} role="img" aria-label={`Rudi, ${state}`} data-scan>
      {/* object-position 20% down: the reference's framing, and the reason the still is padded to the
          frame's own ratio — cover then neither crops her nor letterboxes the field. */}
      <img className="v2-scan-portrait" src={STILL} alt="" aria-hidden draggable={false} />
      {VIDEO && (
        <video
          ref={(el) => { videoRef.current = el; if (el) el.muted = true }}
          className="v2-scan-portrait"
          src={VIDEO}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden
          style={{ opacity: speaking ? 1 : 0 }}
        />
      )}
      <canvas ref={canvasRef} className="v2-scan-canvas" aria-hidden />
      <div className="v2-scan-grain" aria-hidden />
      <div className="v2-scan-veil" aria-hidden />
      {/* ABOVE the veil, unlike the scan. The readouts are chrome and have to stay legible; the
          sequence is part of the picture and belongs under the darkening. Same box, same size, same
          coordinates — see the note beside its context. */}
      <canvas ref={cardsRef} className="v2-scan-cards" aria-hidden />
      {/* The phase readout belongs to the SCAN, not to the screen's chrome — it is meaningless when
          the sequence is not running, so it goes quiet with it rather than sitting there naming a
          phase nothing is in. */}
      <p className="v2-scan-phase" data-quiet={speaking || undefined} aria-hidden>
        <span className="v2-scan-n"><b ref={phaseNoRef}>1</b>/5</span>
        <span className="v2-scan-t" ref={phaseNameRef}>ANALYSIS</span>
      </p>
    </div>
  )
}
