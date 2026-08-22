'use client'

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import { mark } from './timing'
import { PERSONAS, portraitOf, hexToRgb, type PersonaKey } from '@/lib/persona'

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
  /**
   * Run a scan across the portrait, now.
   *
   * PRESENTATION ONLY. It restarts the sweep from the top and displaces the slices harder for about
   * a second; it changes no state, starts nothing and ends nothing. It exists so that touching the
   * portrait does something visible on a device where there is no hover to do it.
   */
  scan: () => void
  state: () => RudiState
}

interface Props {
  /** Which employee this canvas paints. Remount (via `key`) to change it — every asset differs. */
  persona?: PersonaKey
  handleRef?: RefObject<RudiHandle | null>
  onStateChange?: (s: RudiState) => void
  /** Collapsed (idle > 60s): still frame, slow band, no network, no video. */
  minimised?: boolean
  className?: string
  onClick?: () => void
}

interface Node { x: number; y: number }

// WHO THIS CANVAS PAINTS.
//
// The portrait, the loop, the mesh, the stage and the ramp were five literals here, which is fine for
// one employee and is how you end up with a second canvas for the second one. They live in
// lib/persona, and the persona is an argument: one engine, either employee.
//
// Resolved ONCE, at mount. The render loop's effect has [] deps on purpose (see OUTSTANDING §1 — a
// second "effect running" is a genuine remount, and that is a diagnostic worth keeping), so switching
// persona on a live canvas would not re-initialise it. Callers give the element a `key` of the
// persona instead, which remounts it — honest, because every asset it holds is different.
// ── THE SCAN, WHEN THE SUBJECT IS A MACHINE ─────────────────────────────────────────────────────────
//
// Four rings leaving the dome of his face and fading outward, and a halo on the glass breathing under
// them. Five things drawn, and nothing else — no wireframe, no grid, no heat blooms, no coded markers,
// no crosshair, no tick ring, and above all no sweep displacing slices of him. Every one of those was
// something drawn ACROSS a photograph of a person, and across a machine they read as the machine being
// examined rather than as the machine thinking. The only thing that moves is the part of him that is
// already a display.
const RINGS = 4
/** The ring cycle, from the reference prototype. Its own clock, not the sweep's 3600ms — that period
 *  belonged to a band which no longer exists. */
const RING_CYCLE_MS = 4400
/** The halo's breath. The prototype writes sin(t * 10) against a 4.4s cycle, which is this in rad/s;
 *  stated as a rate so it survives the cycle length changing. */
const HALO_RAD_PER_S = 10 / 4.4
/** How far a ring travels before it is gone: r grows to 2.5x the dome and fades linearly. */
const RING_REACH = 1.5
/** Stroke width as a fraction of the dome radius — the prototype's W*.006 against its fr of W*.115. */
const RING_STROKE = 0.052

export interface Dome { x: number; y: number; r: number }
export interface Fit { s: number; dx: number; dy: number; dw: number; dh: number }

/**
 * Cover-fit a source into a canvas, anchored on the dome when there is one.
 *
 * PURE, and exported, because this is the arithmetic the whole change turns on and asserting it
 * through a rendered canvas would be asserting a picture. The fractions and this mapping are what the
 * test pins; the canvas-space product is an output, not a fact.
 *
 * With no dome the crop keeps the 0.54 downward bias the portrait loop has always used. With one, the
 * dome is placed at its own fraction of the canvas height at every width — clamped so the anchor can
 * never pull the image off its own edge and expose the stage behind it.
 */
export function coverFit(cw: number, ch: number, iw: number, ih: number, dome: Dome | null): Fit {
  const s = Math.max(cw / iw, ch / ih)
  const dw = iw * s
  const dh = ih * s
  const dx = (cw - dw) / 2
  const dy = dome
    ? Math.min(0, Math.max(ch - dh, dome.y * ch - dome.y * ih * s))
    : (ch - dh) * 0.54
  return { s, dx, dy, dw, dh }
}

/** Where the dome lands on the canvas: image-space fractions through the fit, never canvas fractions. */
export const domeInCanvas = (f: Fit, iw: number, ih: number, d: Dome) => ({
  x: f.dx + d.x * iw * f.s,
  y: f.dy + d.y * ih * f.s,
  r: d.r * iw * f.s,
})

/** The three stages the readout names, keyed to the ring cycle. */
export const SCAN_PHASES: [number, string][] = [[0, 'ANALYSIS'], [0.4, 'READING'], [0.75, 'ON DUTY']]
export const phaseAt = (t: number): string => {
  let label = SCAN_PHASES[0][1]
  for (const [at, name] of SCAN_PHASES) if (t >= at) label = name
  return label
}

interface Paint {
  still: string
  /** Null when this employee has no speaking loop yet. A missing video costs a texture, never a frame. */
  video: string | null
  /** Null when there is no mesh: the network simply is not drawn. */
  nodes: string | null
  /** The stage the portrait sits on. Rudi's is near-black; Miles's is the acid his own photograph
   *  was shot against, measured from the file rather than guessed, so there is no seam at its edge. */
  bg: string
  stops: [number, [number, number, number]][]
  /** The source's own pixel size. Was two module constants shared by both employees — see lib/persona. */
  iw: number
  ih: number
  /** Present = rings from here; absent = the sweep and the mesh. Fractions of the SOURCE, not the canvas. */
  dome: { x: number; y: number; r: number } | null
  name: string
}

function paintFor(key: PersonaKey): Paint {
  const p = PERSONAS[key]
  const ramp = p.ramp ?? PERSONAS.rudi.ramp!
  return {
    still: portraitOf(p),
    video: p.video,
    nodes: p.nodes,
    bg: p.ground,
    stops: ramp.map((hex, i, all) => [i / (all.length - 1), hexToRgb(hex)]),
    iw: p.width,
    ih: p.height,
    dome: p.dome ?? null,
    name: p.name,
  }
}

function hue(stops: Paint['stops'], t: number): [number, number, number] {
  let i = 0
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++
  const f = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0])
  const a = stops[i][1]
  const b = stops[i + 1][1]
  return [
    (a[0] + (b[0] - a[0]) * f) | 0,
    (a[1] + (b[1] - a[1]) * f) | 0,
    (a[2] + (b[2] - a[2]) * f) | 0,
  ]
}

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

export function RudiCanvas({ handleRef, onStateChange, minimised = false, className, onClick, persona = 'rudi' }: Props) {
  // Read once. See paintFor: a persona change means a remount, keyed by the caller.
  const paint = useRef(paintFor(persona)).current
  const { still: STILL, video: VIDEO, nodes: NODES, bg: STAGE_BG, stops: STOPS, dome: DOME, name: NAME } = paint
  const IW = paint.iw
  const IH = paint.ih
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setStateRaw] = useState<RudiState>('idle')
  // WHAT THE SCAN IS DOING, in a word. The prototype prints it in a row of its own at the top of the
  // frame; the app has no such row and this change does not add one — the readout cards, the ceiling
  // and the phase line are furniture that does not exist here, and building them means the canvas
  // taking layout the DOM owns. So the phase goes where it costs nothing and is not decoration: the
  // accessible name, which otherwise says only 'idle' for the whole of a scan.
  const [phase, setPhase] = useState<string>(SCAN_PHASES[0][1])
  const phaseRef = useRef(phase)

  // Everything the render loop touches lives in refs. The loop must not re-subscribe when a number
  // changes — re-creating the rAF chain on every level update would stutter the animation.
  const stateRef = useRef<RudiState>('idle')
  const levelRef = useRef<number | null>(null)
  const speakEndRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const minRef = useRef(minimised)
  // Whether level() has ever been called. The only thing this component can honestly say about the
  // number's provenance: that it was given one, or that it was not.
  const levelledRef = useRef(false)
  // When the last tap-to-scan happened. 0 = never, which is the sweep's original phase exactly.
  const scanAtRef = useRef(0)

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
    scan() { scanAtRef.current = performance.now() },
    endSession() {
      if (timerRef.current) clearTimeout(timerRef.current)
      speakEndRef.current = 0
      levelRef.current = null
      levelledRef.current = false
      setState('idle')
    },
    // Recorded, and no longer painted: option D took the meter away. The call stays because the
    // voice layer makes it and the handle is its contract, and because the number's provenance was
    // never this component's business — see the note at the top.
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
    let vidA = 0

    // A second canvas for the sweep band, composited with 'lighter' — the reference's approach, and
    // the reason the band glows through the portrait instead of sitting on top of it.
    const sweep = document.createElement('canvas')
    const sctx = sweep.getContext('2d')

    function fit() {
      const r = canvas!.getBoundingClientRect()
      const d = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.round(r.width * d)
      const h = Math.round(r.height * d)
      if (w === 0 || h === 0) return
      // ASSIGNING canvas.width WIPES THE CANVAS. It clears every pixel and resets the 2D context
      // state, even when the value is unchanged — so a fit() on an already-correct size is not a
      // no-op, it is a blank frame. That is what made a mouse move black the screen: the
      // first-interaction handler called fit() on a canvas that was already sized and already
      // painted. Measure first, and only resize when the size has genuinely changed.
      if (w === CW && h === CH) return
      CW = w; CH = h
      canvas!.width = CW; canvas!.height = CH
      sweep.width = CW; sweep.height = CH
      // ── THE CROP IS ANCHORED ON THE THING THE SCAN IS DRAWN AROUND ────────────────────────────
      //
      // It used to be `(CH - DH) * 0.54` for everybody — 0.54 rather than 0.5 so a face sat high in
      // the frame. That is a number tuned to a 680x907 head-and-shoulders, and against the robot's
      // 784x1660 it is actively wrong: the cover fit turns width-driven far sooner, and at a 1200x800
      // hero — an ordinary laptop — it put his face 53px ABOVE the top of the frame. A crop that
      // removes the subject is not a crop. See coverFit, which is where the arithmetic and its test are.
      const f = coverFit(CW, CH, IW, IH, DOME)
      S = f.s; DW = f.dw; DH = f.dh; DX = f.dx; DY = f.dy
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

    /**
     * The scan sweep: 18 displaced slices of the portrait, brightest at the band.
     *
     * A function rather than a block inside draw() because the COLLAPSED path runs it too. On a phone
     * the portrait is a still — no mesh, no video, no bloom — but a photograph that never moves reads
     * as a screenshot of an employee rather than an employee. One implementation, two callers; a
     * second copy would be the one that stops matching.
     */
    function drawSweep(now: number, band: number, amount: number, displace: number) {
      if (!img) return
      for (let sl = 0; sl < 18; sl++) {
        const sy = band - 96 + sl * 12
        if (sy < 0 || sy > CH - 13) continue
        const fall = Math.max(0, 1 - Math.abs(sy - band) / 104) * amount
        if (fall < 0.02) continue
        const off = Math.sin(now / 140 + sl * 0.9) * 11 * fall * displace
        const sry = (sy - DY) / S
        if (sry < 0 || sry > IH - 13 / S) continue
        ctx!.drawImage(img, 0, sry, IW, 13 / S, DX + off - 16, sy, DW + 32, 13)
        ctx!.globalCompositeOperation = 'lighter'
        ctx!.globalAlpha = 0.26 * fall
        ctx!.drawImage(img, 0, sry, IW, 13 / S, DX + off * 2.8 - 16, sy, DW + 32, 13)
        ctx!.globalAlpha = 1
        ctx!.globalCompositeOperation = 'source-over'
      }
    }

    /**
     * Four rings leaving the dome, and the halo under them. The scan, for a subject that is a machine.
     *
     * `amount` is the same scanA the sweep takes, so the rings vanish on the frame listening begins
     * and ease back when idle returns — one rule for both scans.
     */
    function drawRings(now: number, amount: number) {
      if (!DOME || amount < 0.02) return
      // IMAGE SPACE THROUGH THE FIT, never a fraction of the canvas. The prototype can use canvas
      // fractions because its phone and its source share an aspect exactly; here the canvas is a
      // phone, a laptop column or a 172x230 chip, and the same fraction would slide across him.
      const { x: fx, y: fy, r: fr } = domeInCanvas({ s: S, dx: DX, dy: DY, dw: DW, dh: DH }, IW, IH, DOME)
      // Relative to the last tap, so touching him starts a ring from the dome rather than joining one
      // already halfway out. Zero until something taps, which reduces to `now % cycle`.
      const t = ((now - scanAtRef.current) % RING_CYCLE_MS) / RING_CYCLE_MS
      const near = hue(STOPS, 0)
      const far = hue(STOPS, 0.5)

      for (let i = 0; i < RINGS; i++) {
        const p = (t + i / RINGS) % 1
        const r = fr * (1 + p * RING_REACH)
        const a = (1 - p) * 0.34 * amount
        if (a < 0.004) continue
        const g = ctx!.createRadialGradient(fx, fy, r * 0.86, fx, fy, r)
        g.addColorStop(0, rgba(near, 0))
        g.addColorStop(0.6, rgba(near, Number(a.toFixed(3))))
        g.addColorStop(1, rgba(far, 0))
        ctx!.strokeStyle = g
        ctx!.lineWidth = fr * RING_STROKE
        ctx!.beginPath(); ctx!.arc(fx, fy, r, 0, Math.PI * 2); ctx!.stroke()
      }

      // The fifth thing: a soft halo on the glass, breathing.
      const breath = 0.10 + 0.06 * Math.sin((now / 1000) * HALO_RAD_PER_S)
      const glow = ctx!.createRadialGradient(fx, fy, 0, fx, fy, fr * 1.5)
      glow.addColorStop(0, rgba(near, Number((breath * amount).toFixed(3))))
      glow.addColorStop(1, rgba(near, 0))
      ctx!.fillStyle = glow
      ctx!.beginPath(); ctx!.arc(fx, fy, fr * 1.5, 0, Math.PI * 2); ctx!.fill()

      const label = phaseAt(t)
      if (label !== phaseRef.current) { phaseRef.current = label; setPhase(label) }
    }

    function draw(now: number) {
      if (disposed) return
      // A missing still must not KILL the loop. Returning without re-requesting a frame ended it
      // permanently, so anything that cleared the canvas before the image was ready left it black
      // with nothing scheduled to repaint it.
      if (!img) { raf = requestAnimationFrame(draw); return }
      const st = stateRef.current
      ctx!.setTransform(1, 0, 0, 1, 0, 0)
      ctx!.clearRect(0, 0, CW, CH)

      // ── Collapsed: the still, the sweep, and nothing else. ──────────────────────────────────────
      //
      // Was the still plus one slow band every 5.2 seconds — about 1.8s of movement in every 5, which
      // on a phone reads as a static photograph unless you happen to be looking at the right moment.
      // It runs the SAME sweep the full engine does now, at the same rate, and still pays for none of
      // the rest: no mesh, no bloom, no video, no meter. Alive without the whole engine.
      if (minRef.current) {
        ctx!.drawImage(img, DX, DY, DW, DH)
        const v = videoRef.current
        if (v && !v.paused) v.pause()
        if (!reduced) {
          // A machine gets the same rings the full engine draws — they cost four strokes and a
          // gradient, which is well inside what the collapsed path is allowed to spend.
          if (DOME) { drawRings(now, 1); raf = requestAnimationFrame(draw); return }
          // The idle rate from the main path — 3600ms — so a phone and a desktop sweep in step.
          const prog = (now % 3600) / 3600
          drawSweep(now, prog * CH, 1, 1)
          const bp = (now % 5200) / 5200
          if (bp < 0.34) {
            const by = (bp / 0.34) * CH
            const hc = hue(STOPS, bp / 0.34)
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
      // THE BLOOM DOES NOT REACT TO THE MIC. It used to brighten 22% while listening, which is the
      // canvas answering back at the moment option D says it should go quiet — the veil rising is the
      // only thing that moves when listening begins, and it moves once. Speaking still pulses,
      // because then she IS the thing happening.
      const pulse = st === 'speaking' ? 1 + 0.12 * Math.sin(now / 150) : 1
      const period = open ? 1300 : 3600
      // Relative to the last tap, so a tap starts a scan from the top rather than joining one
      // already halfway down. Zero until something taps, and `now % period` is what that reduces to.
      const prog = ((now - scanAtRef.current) % period) / period
      // ~900ms of harder displacement after a tap, easing out. Nothing else changes.
      const burst = scanAtRef.current ? Math.max(0, 1 - (now - scanAtRef.current) / 900) : 0
      const band = prog * CH
      const hc = hue(STOPS, prog)

      // Ambient bloom behind the portrait.
      const g = ctx!.createRadialGradient(CW / 2, CH * 0.4, 20, CW / 2, CH * 0.4, CH * 0.6)
      g.addColorStop(0, rgba(hc, 0.24 * pulse))
      g.addColorStop(1, rgba(hc, 0))
      ctx!.fillStyle = g
      ctx!.fillRect(0, 0, CW, CH)

      // ── NO BREATH. THIS IS A FIX, NOT A PRECAUTION. ─────────────────────────────────────────────
      //
      // There was a ±1% scale on a 3.2s cycle here "so the still never looks frozen". The video below
      // is drawn at DX, DY, DW, DH — unscaled — so the two layers were up to 1% apart in size at the
      // exact moment they cross-fade into one another, which on a phone is about eight pixels of
      // vertical slide over the thirteen frames the fade takes. That has been shipping on the live
      // portrait; it is not a hazard introduced by the robot, it is one the robot made visible.
      //
      // A still that holds position does not look frozen when something else on it is moving.
      ctx!.drawImage(img, DX, DY, DW, DH)

      // ── The state transitions ───────────────────────────────────────────────────────────────────
      // scanA snaps to 0 the moment we leave idle — on the SAME frame, not eased — and eases back in
      // over ~20 frames when idle returns. That asymmetry is the design: attention is instant,
      // relaxation is gradual.
      scanA = st === 'idle' ? scanA + (1 - scanA) * 0.05 : 0
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

      // ── The scan. Rings from the dome for a machine; the sweep for a face. ─────────────────────
      if (DOME) drawRings(now, scanA)
      else drawSweep(now, band, scanA, (st === 'idle' ? 1 : 2.2) + burst * 1.8)

      // ── LISTENING: THE CANVAS DRAWS NOTHING AT ALL. ─────────────────────────────────────────────
      //
      // There was a white veil and a 52-bar level meter here — a rule drawn across her with bars
      // growing out of it. Option D is that the surface goes QUIET while the mic is open: the scan
      // stops, the veil rises so he recedes, and the canvas paints the picture and nothing else. A
      // meter is a second thing claiming to be the signal at the moment the person talking IS the
      // signal, and on a robot it is one more graphic drawn across the machine.
      //
      // The veil that does the receding is the DOM scrim, not a fill painted here — it already sits
      // over the canvas, it can transition its own height, and a canvas fill cannot cross-fade with
      // the composer above it. See .v2-scrim, bound to the state on .v2-root.
      //
      // level() stays on the handle and the voice layer still calls it. It drives nothing now, and
      // that is the honest state: the component was never the right owner of an audio level, and
      // removing the meter is what makes that visible rather than a thing it happens to render.

      // Speaking (and the tail of listening) draws no network and no band at all.
      if (scanA < 0.02) { raf = requestAnimationFrame(draw); return }
      // A machine's scan is the rings and the halo and nothing else. The node network and the sweep
      // band below belong to the portrait loop, and drawing either across him is the thing this
      // change exists to stop.
      if (DOME) { raf = requestAnimationFrame(draw); return }

      // ── The node network, banded into three hue groups by height. ──────────────────────────────
      ctx!.globalCompositeOperation = 'lighter'
      ctx!.lineWidth = 0.8
      for (let hb = 0; hb < 3; hb++) {
        ctx!.strokeStyle = rgba(hue(STOPS, hb / 2), Number((0.5 * scanA).toFixed(3)))
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
        ctx!.fillStyle = rgba(hue(STOPS, Math.min(1, y / CH)), Number(al.toFixed(3)))
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

    // ── THE CANVAS TELLS US WHEN IT HAS A SIZE ──────────────────────────────────────────────────
    //
    // ensureNet() returns early on !CW, which is correct — it cannot lay out a mesh across a zero
    // width. Having no way back was not. The v2 shell renders a placeholder tree until useIsMobile()
    // resolves, so this canvas is measured BEFORE it is laid out: CW was 0 at both fit() calls, the
    // mesh fetch resolved into that zero, ensureNet() returned, netKey stayed '' and nothing ever
    // called it again. The network was never built.
    //
    // Only a resize could recover it, which is why switching tabs and back appeared to fix the screen
    // — returning to a tab happens to fire one. That was a coincidence being relied on. The element
    // now reports its own size, so the mesh is built the moment there is something to build it across.
    const ro = new ResizeObserver(() => {
      fit()
      ensureNet()
      if (!running) drawStill()
    })
    ro.observe(canvas)

    // ── THE FIRST TOUCH STARTS HER ──────────────────────────────────────────────────────────────
    //
    // Something re-measures or re-mounts this canvas on the first real interaction with the page and
    // I never found what. Two observers were added chasing it and neither helped, so this stops
    // chasing: the first pointermove, click, keydown or scroll re-fits, builds the mesh if it is not
    // built, and starts the loop. One listener, four events, removed the moment any of them fires.
    //
    // Until then she is a still frame — the portrait is already painted, so there is nothing missing,
    // only nothing moving. At a second at most that reads as deliberate rather than broken, which is
    // more than the previous behaviour managed.
    //
    // This is a workaround over an unidentified cause and is logged as such in
    // lib/invoices/OUTSTANDING.md. It is not the fix; it is the thing that makes the screen correct
    // while the cause is still unknown.
    const KICK_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'scroll'] as const
    const kick = () => {
      KICK_EVENTS.forEach((e) => window.removeEventListener(e, kick, { capture: true }))
      if (disposed) return
      fit()
      ensureNet()
      sync()
      // If the loop is not running after this — reduced motion, or off-screen — the still is what
      // stays on screen, so repaint it in case fit() resized and cleared.
      if (!running) drawStill()
    }
    // CAPTURE. `scroll` does not bubble, so a listener on window never hears a scroll inside an
    // element — and on the mobile inbox the scroller IS an element, not the document. Someone who
    // loaded the page and only scrolled therefore never kicked the loop. The capture phase runs from
    // window down to the target for non-bubbling events too, so this hears both without the canvas
    // needing to know which element any particular screen scrolls.
    KICK_EVENTS.forEach((e) => window.addEventListener(e, kick, { passive: true, capture: true }))

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
    // node overlay and nothing else — the portrait and the sweep are unaffected. An employee with no
    // mesh at all simply has no network drawn, which is the same code path as a fetch that fails.
    if (NODES) fetch(NODES)
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
      ro.disconnect()
      KICK_EVENTS.forEach((e) => window.removeEventListener(e, kick, { capture: true }))
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
        // Absent for an employee with no speaking loop yet: the crossfade then has nothing to fade
        // to and she speaks over the still, which the render loop already tolerates.
        src={VIDEO ?? undefined}
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
        // NAME, not the literal "Rudi". Miles's canvas has been announcing itself as Rudi since the
        // engine learned to paint two employees — invisible unless you listen to the page, which is
        // exactly the class of bug nobody goes looking for.
        //
        // While she is idle the state word is "idle", which describes nothing; the scan's own phase
        // is what is actually happening, and it is the only place this change surfaces it.
        aria-label={`${NAME}, ${state === 'idle' && DOME ? phase.toLowerCase() : state}`}
      />
    </>
  )
}
