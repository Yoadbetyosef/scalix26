'use client'

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import { mark } from './timing'

// Rudi's face. A reproduction of the reference's canvas engine.
//
// ── A PURE RENDERER OF STATE IT IS TOLD ABOUT ───────────────────────────────────────────────────────
//
// This component owns NO opinion about whose turn it is. No voice activity detection, no thresholds,
// no silence timing, no barge-in rule, no microphone, no SpeechRecognition, no speechSynthesis. All of
// that belongs to the Deepgram Voice Agent, which already has it, and duplicating it here would mean
// two implementations of turn-taking that drift apart.
//
// What it exposes is five calls and a state:
//
//   listen() / stopListening()   the caller is being heard
//   speak(text, ms) / stopSpeaking()   she has the floor, for exactly ms
//   arm()                        her turn is over; waiting for the user
//   level(0..1)                  the number the meter renders — its provenance is not this file's
//                                business, and the component cannot and must not tell a microphone
//                                from a synthesiser
//   state()
//
// The reference read a real microphone here. That is the one thing deliberately removed: the level is
// handed in, so the component can never prompt for a permission or hold a MediaStream.
//
// With no level supplied the meter falls back to the reference's synthetic envelope rather than
// sitting flat — a dead meter reads as broken — and labels itself DEMO so the movement is never
// mistaken for something being heard.
//
// Everything else is the reference: the scan sweep and node network at idle, the sweep cutting to
// zero on the same frame that listening begins, the white veil and monochrome meter while listening,
// the video crossfading in while speaking with no scan and no overlay at all.

/**
 * idle       nothing happening; scan sweep and node network
 * listening  the mic is open and I am talking
 * speaking   she is talking
 * armed      she has finished, the mic is STILL open, it is my turn — the state that makes this a
 *            conversation rather than a walkie-talkie
 */
export type RudiState = 'idle' | 'listening' | 'speaking' | 'armed'

/** The control surface the voice layer drives. Same shape as the reference's `window.Rudi`. */
export interface RudiHandle {
  /** Start speaking and hold for exactly `ms`. Call stopSpeaking() when the audio really ends. */
  speak: (text?: string, ms?: number) => void
  stopSpeaking: () => void
  listen: () => void
  stopListening: () => void
  /** External audio level, 0..1. Drives the meter while listening. */
  level: (v: number) => void
  /** She has finished; the mic is open and it is the caller's turn. */
  arm: () => void
  /** Close the conversation and return to idle. */
  endSession: () => void
  state: () => RudiState
}

interface Props {
  handleRef?: RefObject<RudiHandle | null>
  onStateChange?: (s: RudiState) => void
  /** Collapsed (idle > 60s): still frame, slow band, no network, no video. */
  minimised?: boolean
  className?: string
  onClick?: () => void
}

interface Node { x: number; y: number }

const IW = 680
const IH = 907
const STILL = '/v2/rudi-still.webp'
/** The stage ground. Matches --v2-stage in v2-tokens.css; a literal because the canvas cannot read
 *  a custom property, and the two must move together if either changes. */
const STAGE_BG = '#0d0d10'
const VIDEO = '/v2/rudi-speaking.mp4'
const NODES = '/v2/rudi-nodes.json'

// The reference's three-stop ramp: cyan → violet → pink.
const STOPS: [number, [number, number, number]][] = [
  [0, [34, 211, 238]],
  [0.5, [139, 92, 246]],
  [1, [255, 46, 147]],
]
function hue(t: number): [number, number, number] {
  let i = 0
  while (i < STOPS.length - 2 && t > STOPS[i + 1][0]) i++
  const f = (t - STOPS[i][0]) / (STOPS[i + 1][0] - STOPS[i][0])
  const a = STOPS[i][1]
  const b = STOPS[i + 1][1]
  return [
    (a[0] + (b[0] - a[0]) * f) | 0,
    (a[1] + (b[1] - a[1]) * f) | 0,
    (a[2] + (b[2] - a[2]) * f) | 0,
  ]
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

export function RudiCanvas({ handleRef, onStateChange, minimised = false, className, onClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setStateRaw] = useState<RudiState>('idle')

  // Everything the render loop touches lives in refs. The loop must not re-subscribe when a number
  // changes — re-creating the rAF chain on every level update would stutter the animation.
  const stateRef = useRef<RudiState>('idle')
  const levelRef = useRef<number | null>(null)
  const smoothedRef = useRef(0)
  const speakEndRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const minRef = useRef(minimised)
  // Whether level() has ever been called. The only thing this component can honestly say about the
  // number's provenance: that it was given one, or that it was not.
  const levelledRef = useRef(false)

  useEffect(() => { minRef.current = minimised }, [minimised])

  const setState = useCallback((s: RudiState) => {
    const from = stateRef.current
    if (from === s) return
    // Diagnostic only. A state machine that can strand itself is worth being able to read, and this
    // is the line that shows whether the exit ever happened.
    console.info(`[v2 state] ${Math.round(performance.now())}ms ${from} -> ${s}`)
    stateRef.current = s
    setStateRaw(s)
    onStateChange?.(s)
  }, [onStateChange])

  // ── The control surface ─────────────────────────────────────────────────────────────────────────
  useImperativeHandle(handleRef, (): RudiHandle => ({
    speak(text?: string, ms?: number) {
      console.info(`[v2 state] speak(ms=${ms ?? 6000}) — ceiling only; the caller owns the handover`)
      // THE BYTES. preload="none" means readyState stays 0 until something asks, and the draw loop
      // only plays the video `if (vid.readyState >= 2)` — so without this call that branch was never
      // once true and she never moved. The comment on the <video> said "the first speak calls load()";
      // no speak() ever did. Idempotent: load() on an already-loaded element is a no-op.
      const v = videoRef.current
      if (v && v.readyState < 2) { try { v.load() } catch { /* the still is the fallback */ } }
      speakEndRef.current = performance.now() + (ms ?? 6000)
      if (stateRef.current !== 'speaking') setState('speaking')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (stateRef.current === 'speaking') setState('idle')
      }, Math.max(300, speakEndRef.current - performance.now()))
    },
    stopSpeaking() {
      console.info('[v2 state] stopSpeaking()')
      speakEndRef.current = 0
      if (timerRef.current) clearTimeout(timerRef.current)
      if (stateRef.current === 'speaking') setState('idle')
    },
    listen() { if (stateRef.current !== 'listening') setState('listening') },
    stopListening() { if (stateRef.current === 'listening') setState('idle') },
    arm() { if (stateRef.current !== 'armed') setState('armed') },
    endSession() {
      if (timerRef.current) clearTimeout(timerRef.current)
      speakEndRef.current = 0
      levelRef.current = null
      levelledRef.current = false
      setState('idle')
    },
    level(v: number) { levelledRef.current = true; levelRef.current = Math.min(1, Math.max(0, v)) },
    state() { return stateRef.current },
  }), [setState])

  // ── The render loop ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let disposed = false
    // Reported to the console so the time to first canvas draw is a number rather than an impression.
    let firstDraw = 0
    let vidRequested = false
    const t0 = performance.now()
    let CW = 0, CH = 0, S = 1, DX = 0, DY = 0, DW = 0, DH = 0
    let img: HTMLImageElement | null = null
    let pts: Node[] = []
    let edges: number[] = []
    let raw: [number, number][] = []
    let scanA = 1
    let micA = 0
    let vidA = 0
    const LV = new Float32Array(72)

    // A second canvas for the sweep band, composited with 'lighter' — the reference's approach, and
    // the reason the band glows through the portrait instead of sitting on top of it.
    const sweep = document.createElement('canvas')
    const sctx = sweep.getContext('2d')

    function fit() {
      const r = canvas!.getBoundingClientRect()
      const d = Math.min(2, window.devicePixelRatio || 1)
      CW = Math.round(r.width * d)
      CH = Math.round(r.height * d)
      if (CW === 0 || CH === 0) return
      canvas!.width = CW; canvas!.height = CH
      sweep.width = CW; sweep.height = CH
      S = Math.max(CW / IW, CH / IH)
      DW = IW * S; DH = IH * S
      DX = (CW - DW) / 2
      // 0.54 rather than 0.5: the reference biases the crop downward so the face sits high.
      DY = (CH - DH) * 0.54
    }

    // Built ONCE per canvas size and memoised on it. The points live in canvas space so a genuine
    // size change does invalidate them — but a resize event that reports the same dimensions (which
    // is most of them: scrollbars, devtools, an address bar retracting) must not pay for a rebuild.
    let netKey = ''
    function ensureNet() {
      // Never before the still is drawn. The network is decoration over a portrait; building it first
      // would spend the first frames on an overlay for a picture that is not there yet.
      if (!img) return
      const key = `${CW}x${CH}x${raw.length}`
      if (key === netKey || !raw.length || !CW) return
      netKey = key
      buildNet()
    }

    // Nearest-neighbour graph over the mesh. Never called from the render loop — only from ensureNet.
    function buildNet() {
      pts = raw.map(([x, y]) => ({ x: DX + x * S, y: DY + y * S }))
      edges = []
      const cell = 42
      const map = new Map<string, number[]>()
      pts.forEach((p, i) => {
        const k = `${(p.x / cell) | 0},${(p.y / cell) | 0}`
        const arr = map.get(k)
        if (arr) arr.push(i); else map.set(k, [i])
      })
      for (let i = 0; i < pts.length; i++) {
        const gx = (pts[i].x / cell) | 0
        const gy = (pts[i].y / cell) | 0
        const cand: number[] = []
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const arr = map.get(`${gx + a},${gy + b}`)
          if (arr) cand.push(...arr)
        }
        const near: [number, number][] = []
        for (const q of cand) {
          if (q <= i) continue
          const dx = pts[q].x - pts[i].x, dy = pts[q].y - pts[i].y
          const dd = dx * dx + dy * dy
          if (dd < 3600 && dd > 16) near.push([dd, q])
        }
        near.sort((x, y) => x[0] - y[0])
        for (let n = 0; n < Math.min(2, near.length); n++) edges.push(i, near[n][1])
      }
    }

    /** The meter's envelope. Real level when the voice layer supplies one; the reference's synthetic
     *  wobble when it does not, because a flat meter reads as broken rather than as silent. */
    function envelope(now: number): number {
      // Armed: present, and deliberately still. A meter that idles with movement would read as
      // hearing something; a meter that is gone would read as closed. Flat says "open, waiting".
      if (stateRef.current === 'armed') return 0
      const real = levelRef.current
      if (real === null) {
        return 0.26 + 0.74 * Math.pow(Math.abs(Math.sin(now / 300)), 0.8) * (0.55 + 0.45 * Math.abs(Math.sin(now / 97)))
      }
      // Same attack/decay as the reference's mic smoothing: fast up, slow down.
      const s = smoothedRef.current
      smoothedRef.current = s + (real - s) * (real > s ? 0.55 : 0.14)
      return 0.04 + smoothedRef.current * 1.15
    }

    function draw(now: number) {
      if (disposed || !img) return
      const st = stateRef.current
      ctx!.setTransform(1, 0, 0, 1, 0, 0)
      ctx!.clearRect(0, 0, CW, CH)

      // ── Collapsed: still frame, one slow band, nothing else. ────────────────────────────────────
      if (minRef.current) {
        ctx!.drawImage(img, DX, DY, DW, DH)
        const v = videoRef.current
        if (v && !v.paused) v.pause()
        if (!reduced) {
          const bp = (now % 5200) / 5200
          if (bp < 0.34) {
            const by = (bp / 0.34) * CH
            const hc = hue(bp / 0.34)
            const g = ctx!.createLinearGradient(0, by - 30, 0, by + 6)
            g.addColorStop(0, rgba(hc, 0))
            g.addColorStop(1, rgba(hc, 0.22))
            ctx!.fillStyle = g
            ctx!.fillRect(0, by - 30, CW, 36)
          }
          raf = requestAnimationFrame(draw)
        }
        return
      }

      // ── ARMED IS LISTENING ──────────────────────────────────────────────────────────────────────
      //
      // The mic is open and it is the caller's turn in BOTH. The only thing that differs is whether
      // sound is arriving, so the only thing that may differ on screen is the meter's amplitude and
      // one word of label. Everything else — the veil, the bloom, the band's rate — is shared, and
      // any graphic belonging to one and not the other makes it read as a separate screen rather than
      // a moment inside a conversation.
      const open = st === 'listening' || st === 'armed'
      const pulse = st === 'speaking' ? 1 + 0.12 * Math.sin(now / 150) : open ? 1.22 : 1
      const period = open ? 1300 : 3600
      const prog = (now % period) / period
      const band = prog * CH
      const hc = hue(prog)

      // Ambient bloom behind the portrait.
      const g = ctx!.createRadialGradient(CW / 2, CH * 0.4, 20, CW / 2, CH * 0.4, CH * 0.6)
      g.addColorStop(0, rgba(hc, 0.24 * pulse))
      g.addColorStop(1, rgba(hc, 0))
      ctx!.fillStyle = g
      ctx!.fillRect(0, 0, CW, CH)

      // A breath: ±1% scale on a 3.2s cycle, so the still never looks frozen.
      const br = 1 + 0.01 * Math.sin(now / 3200)
      ctx!.drawImage(img, DX - (DW * (br - 1)) / 2, DY - (DH * (br - 1)) / 2, DW * br, DH * br)

      // ── The state transitions ───────────────────────────────────────────────────────────────────
      // scanA snaps to 0 the moment we leave idle — on the SAME frame, not eased — and eases back in
      // over ~20 frames when idle returns. That asymmetry is the design: attention is instant,
      // relaxation is gradual.
      scanA = st === 'idle' ? scanA + (1 - scanA) * 0.05 : 0
      // Armed keeps the veil and the meter: the mic is still open, so the surface must still look
      // open. What changes is that the bars sit flat — see envelope().
      micA += ((st === 'listening' || st === 'armed' ? 1 : 0) - micA) * 0.22
      // Only SHE gets the video. Armed is my turn, and showing her mouth moving through it would say
      // the opposite of what the state means.
      const vTarget = st === 'speaking' ? 1 : 0
      vidA += (vTarget - vidA) * 0.075

      // ── THE VIDEO IS OPTIONAL, ALWAYS ────────────────────────────────────────────────────────
      //
      // Nothing waits on it. It is not fetched until the first time she speaks, and if it is not
      // decodable yet she speaks over the still — the crossfade simply has nothing to fade to. The
      // rule is that a missing video costs a texture and never a frame, because the alternative is
      // the black screen this was reported as.
      const vid = videoRef.current
      if (vid) {
        if (vTarget && !vidRequested) { vidRequested = true; vid.load() }
        if (vid.readyState >= 2) {
          // `void vid.play()` threw the promise away, and a try/catch cannot see an async rejection —
          // so the catch labelled "autoplay refused" had never caught one. Worse, currentTime = 0 ran
          // on EVERY frame the element stayed paused, so a rejected play() reset her to frame zero
          // sixty times a second: the frozen first frame that was reported.
          //
          // Now: rewind only when a new utterance begins, ask once, and record why if it says no.
          if (vTarget && vid.paused && !playPending) {
            if (!playedThisTurn) { vid.currentTime = 0; playedThisTurn = true }
            playPending = true
            vid.play().then(
              () => { playPending = false; playBlocked = false },
              (err: unknown) => {
                playPending = false; playBlocked = true
                // Logged once per block, not per frame.
                console.warn(`[v2 video] play() rejected: ${(err as Error)?.name ?? 'unknown'} — muted=${vid.muted} readyState=${vid.readyState}`)
              },
            )
          }
          if (!vTarget) { playedThisTurn = false; if (vidA < 0.02 && !vid.paused) vid.pause() }
          if (vidA > 0.006) {
            ctx!.globalAlpha = vidA
            ctx!.drawImage(vid, DX, DY, DW, DH)
            ctx!.globalAlpha = 1
          }
        }
      }

      // ── Scan sweep: 18 displaced slices of the portrait, brightest at the band. ─────────────────
      for (let sl = 0; sl < 18; sl++) {
        const sy = band - 96 + sl * 12
        if (sy < 0 || sy > CH - 13) continue
        const fall = Math.max(0, 1 - Math.abs(sy - band) / 104) * scanA
        if (fall < 0.02) continue
        const off = Math.sin(now / 140 + sl * 0.9) * 11 * fall * (st === 'idle' ? 1 : 2.2)
        const sry = (sy - DY) / S
        if (sry < 0 || sry > IH - 13 / S) continue
        ctx!.drawImage(img, 0, sry, IW, 13 / S, DX + off - 16, sy, DW + 32, 13)
        ctx!.globalCompositeOperation = 'lighter'
        ctx!.globalAlpha = 0.26 * fall
        ctx!.drawImage(img, 0, sry, IW, 13 / S, DX + off * 2.8 - 16, sy, DW + 32, 13)
        ctx!.globalAlpha = 1
        ctx!.globalCompositeOperation = 'source-over'
      }

      // ── Listening: white veil + monochrome level meter. ────────────────────────────────────────
      if (micA > 0.01) {
        ctx!.fillStyle = `rgba(250,250,252,${(0.6 * micA).toFixed(3)})`
        ctx!.fillRect(0, 0, CW, CH)

        const wN = 52
        const wW = CW * 0.56
        const wX = (CW - wW) / 2
        // BELOW the mouth, not across it. Her lips are the one part worth seeing while she talks, and
        // a rule drawn through them is the first thing the eye goes to.
        const wY = CH * 0.64
        const gap = wW / wN
        const env = envelope(now)

        // ── PRESENCE RISES WITH LEVEL ────────────────────────────────────────────────────────────
        //
        // At rest this was a solid dark rule with end ticks — an object in its own right, drawn
        // across her face, at a moment when nothing is happening. It should be almost nothing when
        // silent and gather weight only as sound arrives, so the meter reads as a property of the
        // sound rather than as furniture.
        const energy = Math.min(1, Math.max(0, env))
        ctx!.strokeStyle = `rgba(14,14,17,${(micA * (0.09 + 0.34 * energy)).toFixed(3)})`
        ctx!.lineWidth = 1 + 0.6 * energy
        ctx!.beginPath()
        ctx!.moveTo(wX, wY)
        ctx!.lineTo(wX + wW, wY)
        ctx!.stroke()

        for (let wi = 0; wi < wN; wi++) {
          const edge = Math.pow(Math.sin((wi / (wN - 1)) * Math.PI), 0.45)
          const tgt = env * edge * (0.2 + 0.8 * Math.pow(Math.abs(Math.sin(wi * 3.1 + now / 62)), 1.5))
          LV[wi] += (tgt - LV[wi]) * (tgt > LV[wi] ? 0.6 : 0.22)
          // NO minimum height. It used to be Math.max(1.5, …), which at zero amplitude drew 52
          // bars three pixels tall and thirteen apart — a dotted rule, and the single thing that made
          // the waiting state look like a different screen. Bars now grow out of the baseline and
          // return into it, so silence is a flat line and speech is the same line with amplitude.
          const hgt = LV[wi] * CH * 0.105 * micA
          if (hgt < 0.4) continue
          ctx!.fillStyle = `rgba(14,14,17,${(0.78 * micA).toFixed(3)})`
          ctx!.fillRect(wX + wi * gap, wY - hgt, 2.2, hgt * 2)
        }
        // NO LABEL. The state is on her face and in the meter's own weight; a word stamped across
        // her portrait to name what the portrait is already showing was the last thing making the
        // listening state look like a different screen. Whether level() has ever been supplied is
        // still tracked in levelledRef for the console — it just no longer writes DEMO over her.
        ctx!.textAlign = 'left'
      }

      // Speaking (and the tail of listening) draws no network and no band at all.
      if (scanA < 0.02) { raf = requestAnimationFrame(draw); return }

      // ── The node network, banded into three hue groups by height. ──────────────────────────────
      ctx!.globalCompositeOperation = 'lighter'
      ctx!.lineWidth = 0.8
      for (let hb = 0; hb < 3; hb++) {
        ctx!.strokeStyle = rgba(hue(hb / 2), Number((0.5 * scanA).toFixed(3)))
        ctx!.beginPath()
        for (let e = 0; e < edges.length; e += 2) {
          const A = pts[edges[e]], B = pts[edges[e + 1]]
          if (Math.abs(A.y - band) > 96) continue
          if ((((A.y / CH) * 2.999) | 0) !== hb) continue
          ctx!.moveTo(A.x, A.y)
          ctx!.lineTo(B.x, B.y)
        }
        ctx!.stroke()
      }
      for (let i = 0; i < pts.length; i++) {
        const { x, y } = pts[i]
        const dd = Math.abs(y - band)
        if (dd > 96) continue
        const al = Math.pow(1 - dd / 96, 2) * 0.95 * scanA * (0.55 + 0.45 * Math.sin((x + y) * 0.05 + now / 210))
        if (al < 0.04) continue
        ctx!.fillStyle = rgba(hue(Math.min(1, y / CH)), Number(al.toFixed(3)))
        ctx!.fillRect(x - 1.2, y - 1.2, 2.4, 2.4)
      }
      ctx!.globalCompositeOperation = 'source-over'

      // ── The band itself, drawn offscreen then composited with 'lighter'. ───────────────────────
      if (sctx) {
        sctx.setTransform(1, 0, 0, 1, 0, 0)
        sctx.clearRect(0, 0, CW, CH)
        const lg = sctx.createLinearGradient(0, band - 46, 0, band + 10)
        lg.addColorStop(0, rgba(hc, 0))
        lg.addColorStop(0.72, rgba(hc, Number((0.18 * scanA).toFixed(3))))
        lg.addColorStop(0.96, rgba(hc, Number((0.55 * scanA).toFixed(3))))
        lg.addColorStop(1, rgba(hc, 0))
        sctx.fillStyle = lg
        sctx.fillRect(0, band - 46, CW, 56)
        sctx.fillStyle = `rgba(255,255,255,${(0.8 * scanA).toFixed(3)})`
        sctx.fillRect(0, band - 1.2, CW, 1.6)
        ctx!.globalCompositeOperation = 'lighter'
        ctx!.drawImage(sweep, 0, 0)
        ctx!.globalCompositeOperation = 'source-over'
      }

      raf = requestAnimationFrame(draw)
    }

    /** The token stage colour. Down before any fetch resolves, so the canvas is never transparent
     *  over a bare region — "black for a minute" is what an unpainted canvas looks like. */
    function paintGround() {
      if (!ctx || CW === 0) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = STAGE_BG
      ctx.fillRect(0, 0, CW, CH)
    }

    /** One static frame — reduced motion, hidden tab, hero off-screen. */
    function drawStill() {
      if (CW === 0) return
      paintGround()
      if (!img) return
      ctx!.drawImage(img, DX, DY, DW, DH)
    }

    // ── Run / pause ─────────────────────────────────────────────────────────────────────────────
    // Paused when the tab is hidden OR the hero has scrolled out of view. Both are checked because
    // they are different absences and either one alone leaves the loop burning frames nobody sees.
    // The ~30s stillness was measured and is not real: loop started +16ms, first canvas draw 22ms
    // after mount. The seeded onScreen below stays — it is correct regardless — and the instrumentation
    // that proved it is removed rather than left behind as permanent console noise.

    let visible = !document.hidden
    let onScreen = true
    let running = false
    // Video play() bookkeeping, per the loop above.
    let playPending = false
    let playBlocked = false
    let playedThisTurn = false

    function start() {
      if (running || reduced || disposed) return
      running = true
      // The loop only ever starts after the still has been drawn — see the ready.then below.
      raf = requestAnimationFrame(draw)
    }
    function stop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      const v = videoRef.current
      if (v && !v.paused) v.pause()
    }
    function sync() {
      if (visible && onScreen) start()
      else { stop(); drawStill() }
    }

    const onVisibility = () => { visible = !document.hidden; sync() }
    document.addEventListener('visibilitychange', onVisibility)

    // IntersectionObserver fires once immediately with the CURRENT state. At that moment the canvas
    // can still be zero-sized — the v2 shell renders a placeholder tree until useIsMobile() resolves,
    // so this element is measured before it has been laid out. A zero-sized element never intersects,
    // so that first callback set onScreen=false and stopped a loop that had started correctly, and
    // nothing re-fired it until a scroll or a resize. That was the half-minute of stillness.
    //
    // The rect is the seed and the guard: a zero-sized canvas is not evidence of being off-screen, it
    // is evidence of not having been laid out yet. The observer stays the ongoing source of truth.
    const laidOut = () => { const r = canvas.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const io = new IntersectionObserver(
      ([entry]) => { if (!entry.isIntersecting && !laidOut()) return; onScreen = entry.isIntersecting; sync() },
      { threshold: 0.01 },
    )
    io.observe(canvas)
    onScreen = laidOut() ? canvas.getBoundingClientRect().bottom > 0 : true
    sync()

    // A blocked play() is the browser's autoplay decision, and the next genuine gesture is when it can
    // be reversed. One attempt, then the listener removes itself — retrying on every click would spam
    // the console with a refusal the user has already been told about.
    const onGesture = () => {
      const v = videoRef.current
      if (v && playBlocked && v.readyState >= 2) { playBlocked = false; v.play().catch(() => { playBlocked = true }) }
    }
    window.addEventListener('pointerdown', onGesture)

    const onResize = () => { fit(); ensureNet(); if (!running) drawStill() }
    window.addEventListener('resize', onResize)

    // ── FIRST PAINT ──────────────────────────────────────────────────────────────────────────────
    //
    // The ground colour goes down before anything is fetched, so the stage is never bare. Then the
    // still paints the moment its bitmap is DECODED — decode() rather than onload, because onload
    // fires when the bytes have arrived and the first drawImage can then still block on decoding a
    // 680x907 image. Nothing in this path waits on the video, the mesh, or the network build.
    fit()
    paintGround()

    const image = new Image()
    // Static, same-origin, and the only thing standing between the visitor and a picture.
    image.fetchPriority = 'high'
    image.decoding = 'async'
    image.src = STILL

    const ready = typeof image.decode === 'function'
      ? image.decode().catch(() => new Promise<void>((res) => { image.onload = () => res(); image.onerror = () => res() }))
      : new Promise<void>((res) => { image.onload = () => res(); image.onerror = () => res() })

    ready.then(() => {
      if (disposed) return
      img = image
      fit()
      drawStill()                       // <- the picture is on screen HERE, before any effect starts
      firstDraw = performance.now()
      mark('canvas')
      if (!reduced) sync()
    })

    // The mesh is an ENHANCEMENT and is fetched after the still is on its way. A failure costs the
    // node overlay and nothing else — the portrait and the sweep are unaffected.
    fetch(NODES)
      .then((r) => r.json())
      .then((d: { points: [number, number][] }) => {
        if (disposed) return
        raw = d.points || []
        netKey = ''                     // force one build at the current size
        ensureNet()
      })
      .catch(() => { /* no node overlay; everything else renders */ })

    // One line, once, naming the two numbers that matter.
    const report = setTimeout(() => {
      if (firstDraw) {
        console.info(`[v2] first canvas draw ${Math.round(firstDraw - t0)}ms after mount`)
      }
    }, 3000)

    return () => {
      disposed = true
      clearTimeout(report)
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointerdown', onGesture)
      io.disconnect()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <>
      {/* Off-screen source for the speaking crossfade. Never displayed directly — the loop samples it
          into the canvas — so it carries no controls and no layout. Absent under reduced motion. */}
      {/* preload="none" — the bytes are not requested until the first speak calls load(). width and
          height are stated so the browser can size it without fetching, and it is off the layout
          entirely. Sampled into the canvas, never displayed. */}
      <video
        // React sets `muted` as a property and it is not always reflected before the first play(),
        // which is one of the few ways a muted element still trips the autoplay policy. Set on the
        // node itself, where the policy actually reads it.
        ref={(el) => { videoRef.current = el; if (el) el.muted = true }}
        src={VIDEO}
        width={IW}
        height={IH}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden
        style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none', top: 0, left: 0 }}
      />
      <canvas
        ref={canvasRef}
        className={className}
        onClick={onClick}
        role="img"
        aria-label={`Rudi, ${state}`}
      />
    </>
  )
}
