import type { AvatarConnectOptions, AvatarSession, AvatarState, BusinessBrainAvatarProvider, SpeakHandle, SpeakOptions } from './types'

// ── Placeholder avatar ─────────────────────────────────────────────────────────────
// Animates the already-loaded COO portrait entirely on the client. No video is rendered,
// generated, or downloaded — the ONLY streamed asset is the cached TTS audio, which we also
// analyse in real time to drive the mouth glow + waveform. Everything else (breathing, blink,
// head drift, framing) is requestAnimationFrame math. Ready the instant it mounts.
//
// Note: true per-phoneme lip-sync on a still photo isn't possible client-side, so "speaking"
// is expressed as an audio-reactive glow, a subtle head nod on peaks, and a live waveform —
// a premium stand-in that a real streaming provider replaces with an actual talking video.

class PlaceholderSession implements AvatarSession {
  private raf = 0
  private state: AvatarState = 'idle'
  private level = 0
  private start = performance.now()
  private nextBlink = performance.now() + 1500
  private blinkStart = 0
  private paused = false

  // audio graph
  private audio: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private freq: Uint8Array | null = null
  private time: Uint8Array | null = null
  private synthSpeaking = false // speechSynthesis fallback → no analyser, use a synthetic envelope

  // dom
  private faceWrap: HTMLDivElement
  private mouthClip: HTMLDivElement
  private mouthImg: HTMLImageElement
  private glow: HTMLDivElement
  private ring: HTMLDivElement
  private canvas: HTMLCanvasElement
  private cctx: CanvasRenderingContext2D | null
  private ro: ResizeObserver
  private nodes: HTMLElement[] = [] // only the DOM this session created — so destroy() never clobbers a sibling session (React StrictMode double-mounts)

  constructor(private container: HTMLElement, opts: AvatarConnectOptions) {
    // Only establish a positioning context if the host hasn't already — never override an
    // `absolute inset-0` (that would collapse the container to 0 height and hide the face).
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    container.style.overflow = 'hidden'
    container.style.background = 'radial-gradient(120% 120% at 50% 20%, #16204a 0%, #0a0e24 60%, #05070f 100%)'

    this.faceWrap = document.createElement('div')
    this.faceWrap.style.cssText = 'position:absolute;inset:0;transform-origin:50% 45%;will-change:transform,filter'
    const img = document.createElement('img')
    img.src = opts.portraitUrl
    img.alt = 'Your AI COO'
    img.draggable = false
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:50% 22%;user-select:none'
    this.faceWrap.appendChild(img)

    // Mouth layer — a copy of the face clipped to the mouth region, stretched vertically with
    // the voice to fake a jaw/lip "talking" motion. It sits inside faceWrap (so it breathes
    // with the head) and is pixel-identical to the base at rest, so there is no visible seam.
    this.mouthClip = document.createElement('div')
    this.mouthClip.style.cssText = 'position:absolute;overflow:hidden;pointer-events:none;will-change:transform;-webkit-mask-image:radial-gradient(70% 78% at 50% 42%, #000 50%, transparent 100%);mask-image:radial-gradient(70% 78% at 50% 42%, #000 50%, transparent 100%)'
    this.mouthImg = document.createElement('img')
    this.mouthImg.src = opts.portraitUrl
    this.mouthImg.draggable = false
    this.mouthImg.style.cssText = 'position:absolute;object-fit:cover;object-position:50% 22%;transform-origin:50% 0%;user-select:none;will-change:transform'
    this.mouthClip.appendChild(this.mouthImg)
    this.faceWrap.appendChild(this.mouthClip)

    // soft framing vignette so the photo reads as a "camera feed"
    const vignette = document.createElement('div')
    vignette.style.cssText = 'position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 120px 30px rgba(5,7,15,0.55)'

    // speaking glow — brightens with the voice
    this.glow = document.createElement('div')
    this.glow.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .1s linear;background:radial-gradient(60% 45% at 50% 70%, rgba(91,108,240,0.55), transparent 70%)'

    // state ring (listening/thinking accent)
    this.ring = document.createElement('div')
    this.ring.style.cssText = 'position:absolute;inset:0;pointer-events:none;border-radius:inherit;opacity:0;transition:opacity .3s ease;box-shadow:inset 0 0 0 3px rgba(91,108,240,0.6)'

    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:absolute;left:0;right:0;bottom:0;width:100%;height:26%;pointer-events:none'
    this.cctx = this.canvas.getContext('2d')

    this.nodes = [this.faceWrap, vignette, this.glow, this.ring, this.canvas]
    container.append(...this.nodes)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.raf = requestAnimationFrame(this.draw)
  }

  private resize() {
    const r = this.container.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.max(1, Math.round(r.width * dpr))
    this.canvas.height = Math.max(1, Math.round(r.height * 0.26 * dpr))
    // mouth window over the lower-centre of the face; inner img is the full face, offset so
    // its pixels line up exactly with the base beneath.
    const W = r.width, H = r.height
    const cl = 0.30 * W, ct = 0.56 * H, cw = 0.40 * W, ch = 0.30 * H
    this.mouthClip.style.left = `${cl}px`; this.mouthClip.style.top = `${ct}px`
    this.mouthClip.style.width = `${cw}px`; this.mouthClip.style.height = `${ch}px`
    this.mouthImg.style.width = `${W}px`; this.mouthImg.style.height = `${H}px`
    this.mouthImg.style.left = `${-cl}px`; this.mouthImg.style.top = `${-ct}px`
  }

  setState(state: AvatarState) {
    this.state = state
    this.ring.style.opacity = state === 'listening' || state === 'thinking' ? '1' : '0'
    this.ring.style.boxShadow = state === 'listening'
      ? 'inset 0 0 0 3px rgba(52,211,153,0.6)'
      : 'inset 0 0 0 3px rgba(91,108,240,0.55)'
  }

  getLevel() { return this.level }

  speak(opts: SpeakOptions): SpeakHandle {
    this.stopAudio()
    this.paused = false
    this.setState('speaking')

    if (opts.audioUrl) {
      // Real audio → real amplitude. Route the element through an analyser AND to the speakers.
      const audio = new Audio()
      audio.src = opts.audioUrl
      audio.crossOrigin = 'anonymous'
      this.audio = audio
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new Ctor()
        const srcNode = this.ctx.createMediaElementSource(audio)
        const analyser = this.ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.75
        srcNode.connect(analyser)
        analyser.connect(this.ctx.destination)
        this.analyser = analyser
        this.freq = new Uint8Array(analyser.frequencyBinCount)
        this.time = new Uint8Array(analyser.fftSize)
      } catch { /* analyser optional — audio still plays */ }

      let idx = -1
      audio.ontimeupdate = () => {
        if (!audio.duration) return
        const i = Math.min(opts.segments.length - 1, Math.floor((audio.currentTime / audio.duration) * opts.segments.length))
        if (i !== idx) { idx = i; opts.onSegment(i) }
      }
      audio.onended = () => { this.setState('idle'); opts.onEnd() }

      const play = () => { this.ctx?.resume().catch(() => {}); return audio.play() }
      play().catch(() => opts.onBlocked?.())

      return {
        pause: () => { this.paused = true; audio.pause() },
        resume: () => { this.paused = false; play().catch(() => {}) },
        stop: () => this.stopAudio(),
      }
    }

    // No cached audio → browser speechSynthesis, with a synthetic speaking envelope.
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      this.synthSpeaking = true
      window.speechSynthesis.cancel()
      opts.segments.forEach((seg, i) => {
        const u = new SpeechSynthesisUtterance(seg.text)
        u.rate = 1; u.pitch = 0.95
        u.onstart = () => opts.onSegment(i)
        if (i === opts.segments.length - 1) u.onend = () => { this.synthSpeaking = false; this.setState('idle'); opts.onEnd() }
        window.speechSynthesis.speak(u)
      })
      return {
        pause: () => { this.paused = true; window.speechSynthesis.pause() },
        resume: () => { this.paused = false; window.speechSynthesis.resume() },
        stop: () => this.stopAudio(),
      }
    }

    // No audio path at all → just end.
    queueMicrotask(() => { this.setState('idle'); opts.onEnd() })
    return { pause: () => {}, resume: () => {}, stop: () => this.stopAudio() }
  }

  private stopAudio() {
    if (this.audio) { this.audio.pause(); this.audio.onended = null; this.audio.ontimeupdate = null; this.audio = null }
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null }
    this.analyser = null; this.freq = null; this.time = null
    if (this.synthSpeaking && typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
    this.synthSpeaking = false
    this.level = 0
  }

  private measure(now: number): number {
    if (this.paused) return 0
    if (this.analyser && this.time && this.audio && !this.audio.paused) {
      this.analyser.getByteTimeDomainData(this.time as Uint8Array<ArrayBuffer>)
      let sum = 0
      for (let i = 0; i < this.time.length; i++) { const v = (this.time[i] - 128) / 128; sum += v * v }
      return Math.min(1, Math.sqrt(sum / this.time.length) * 3.2)
    }
    if (this.synthSpeaking) {
      // speech-like envelope: fast voicing bursts with brief gaps
      const s = now / 1000
      const voiced = (Math.sin(s * 13) * 0.5 + 0.5) * (Math.sin(s * 2.3) * 0.5 + 0.5)
      return this.state === 'speaking' ? 0.25 + voiced * 0.6 : 0
    }
    return 0
  }

  private draw = () => {
    this.raf = requestAnimationFrame(this.draw)
    const now = performance.now()
    const t = (now - this.start) / 1000

    const target = this.measure(now)
    this.level += (target - this.level) * 0.35

    // blink — a quick vertical squash + brightness dip; reads as "alive" without an eyelid cut
    if (now > this.nextBlink && this.blinkStart === 0) this.blinkStart = now
    let blinkK = 0
    if (this.blinkStart) {
      const p = (now - this.blinkStart) / 150
      if (p >= 1) { this.blinkStart = 0; this.nextBlink = now + 2600 + Math.random() * 3600 }
      else blinkK = Math.sin(p * Math.PI) // 0→1→0
    }

    // breathing + slow ken-burns drift + gentle head sway; a small nod on voice peaks
    const breathe = 1 + Math.sin(t * 1.05) * 0.012
    const driftX = Math.sin(t * 0.13) * 0.9
    const driftY = Math.cos(t * 0.17) * 0.7
    const sway = Math.sin(t * 0.5) * 0.5 + (this.state === 'thinking' ? -1.2 : 0)
    const nodY = -this.level * 3.2
    const squashY = 1 - blinkK * 0.05
    this.faceWrap.style.transform =
      `translate(${driftX}%, ${driftY + nodY / 4}%) scale(${(breathe * 1.03).toFixed(4)}, ${(breathe * 1.03 * squashY).toFixed(4)}) rotate(${sway.toFixed(2)}deg)`
    this.faceWrap.style.filter = `brightness(${(1 - blinkK * 0.28).toFixed(3)})`

    // mouth "talks" — the clipped mouth region drops/stretches with the voice
    const jaw = this.state === 'speaking' ? this.level : 0
    this.mouthImg.style.transform = `translateY(${(jaw * 2.6).toFixed(2)}px) scaleY(${(1 + jaw * 0.17).toFixed(3)})`

    // glow follows the voice
    this.glow.style.opacity = this.state === 'speaking' ? (0.12 + this.level * 0.7).toFixed(3) : '0'

    this.drawWave()
  }

  private drawWave() {
    const ctx = this.cctx; if (!ctx) return
    const w = this.canvas.width, h = this.canvas.height
    ctx.clearRect(0, 0, w, h)
    if (this.state !== 'speaking') return
    const bars = 48
    const gap = w / bars
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(139,152,255,0.95)')
    grad.addColorStop(1, 'rgba(91,108,240,0.15)')
    ctx.fillStyle = grad
    for (let i = 0; i < bars; i++) {
      let m: number
      if (this.freq && this.analyser) {
        this.analyser.getByteFrequencyData(this.freq as Uint8Array<ArrayBuffer>)
        m = (this.freq[Math.floor((i / bars) * this.freq.length * 0.7)] / 255) * (this.paused ? 0 : 1)
      } else {
        m = this.level * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.6 + performance.now() / 140)))
      }
      const bh = Math.max(h * 0.04, m * h * 0.9)
      const x = i * gap
      const bw = gap * 0.5
      ctx.beginPath()
      const r = bw / 2
      ctx.roundRect(x, h - bh, bw, bh, r)
      ctx.fill()
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.stopAudio()
    // Remove only our own nodes — never wipe the container, which a concurrent session
    // (StrictMode double-mount) may already own.
    this.nodes.forEach((n) => n.remove())
  }
}

export class PlaceholderAvatarProvider implements BusinessBrainAvatarProvider {
  readonly id = 'placeholder'
  readonly displayName = 'Animated Portrait (built-in)'
  readonly isLive = false
  async connect(container: HTMLElement, opts: AvatarConnectOptions): Promise<AvatarSession> {
    // Synchronous under the hood — resolves immediately, so there is zero render delay.
    return new PlaceholderSession(container, opts)
  }
}
