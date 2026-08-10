'use client'

import { rudiReply, type ReplyFacts } from './rudi-line'
import type { RudiHandle } from './rudi-canvas'

// A browser-only voice loop, in ONE file, so you can actually talk to her.
//
// ── THIS IS A HARNESS, NOT A LAYER ──────────────────────────────────────────────────────────────────
//
// Everything about audio and turn-taking lives here and nowhere else. RudiCanvas keeps its exact API
// and stays a pure renderer of state it is told about — no microphone, no VAD, no opinion about whose
// turn it is, ever. This file only presses the same seven buttons the Deepgram Voice Agent will press:
//
//   listen() · stopListening() · speak(text, ms) · stopSpeaking() · level(0..1) · arm() · state()
//
// So the swap is one import in the shell. Delete this file and the voice behaviour goes with it,
// leaving the component untouched — which is the point, because the real turn-taking already exists
// in the agent and must not be reimplemented in a browser.
//
// Nothing here touches the backend: getUserMedia for the level, the browser's own SpeechRecognition
// for the transcript, speechSynthesis for the voice, and a pure local function for the reply. No key,
// no model call, no dependency.
//
// ── HOW IT DEGRADES ─────────────────────────────────────────────────────────────────────────────────
//
//   no microphone   the meter keeps the synthetic envelope and the canvas labels itself DEMO — which
//                   happens by itself, because the canvas prints DEMO until level() is first called,
//                   and this file simply never calls it.
//   no recognition  the meter is still real; the turn ends on VAD and she answers without a transcript
//   no synthesis    the reply is shown and held for a duration estimated from its own text

export interface VoiceSession { stop: () => void }

export interface VoiceOptions {
  /** The numbers already on the page. Null until they stream in; the reply says so rather than guessing. */
  facts: () => ReplyFacts | null
  /** The running transcript, for the small line above the caption. */
  onHeard: (text: string | null) => void
  /** Her answer, which replaces the caption. */
  onReply: (text: string) => void
  /** Fires when the session closes on its own, so the shell can drop its handle. */
  onEnd?: () => void
  /** How long armed waits before closing. Matches the draining hairline. */
  armedMs?: number
}

// ── Turn-taking constants ───────────────────────────────────────────────────────────────────────────
//
// Speech STARTS when the level holds above threshold for 150ms — long enough that a door or a
// keyboard does not open a turn. It ENDS after 900ms below, which is longer than the pause inside a
// sentence and shorter than the pause between two of them. Those two numbers are the whole feel of it,
// and a fixed timer instead of them is what makes a voice product feel like a phone menu.
const VAD_START_MS = 150
const VAD_END_MS = 900
/** Ordinary speech sits well above this; room tone sits below. */
const VAD_THRESHOLD = 0.055
/** While she speaks. Above what leaks past echo cancellation, below a real interruption. */
const VAD_THRESHOLD_DUPLEX = 0.2
/** No recognition available: answer after this much silence instead. */
const NO_ASR_PAUSE_MS = 3000

type SR = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

function RecognitionCtor(): (new () => SR) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

const hasSynthesis = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/** Roughly 165 words a minute, floored so a two-word answer still registers. */
const estimateMs = (text: string) =>
  Math.max(1600, Math.round((text.split(/\s+/).filter(Boolean).length / 165) * 60_000))

/**
 * Open a conversation. One press in, one press out.
 *
 *   listening -> she replies -> armed -> listening -> …
 *
 * with barge-in short-circuiting speaking -> listening at any moment. The MICROPHONE STAYS OPEN for
 * the whole session rather than being reopened per turn: reopening would put a permission-shaped gap
 * between every sentence, and leave a device that cannot hear an interruption because it is not
 * listening for one.
 */
export function startVoice(rudi: RudiHandle, opts: VoiceOptions): VoiceSession {
  const armedMs = opts.armedMs ?? 12_000

  let stopped = false
  let stream: MediaStream | null = null
  let audio: AudioContext | null = null
  let raf = 0
  let rec: SR | null = null
  let heard = ''
  let smoothed = 0
  let armedTimer: ReturnType<typeof setTimeout> | null = null
  let noAsrTimer: ReturnType<typeof setTimeout> | null = null
  let sayTimer: ReturnType<typeof setTimeout> | null = null

  // VAD state
  let above = 0
  let below = 0
  let voicing = false

  const clearTimers = () => {
    if (armedTimer) { clearTimeout(armedTimer); armedTimer = null }
    if (noAsrTimer) { clearTimeout(noAsrTimer); noAsrTimer = null }
    if (sayTimer) { clearTimeout(sayTimer); sayTimer = null }
  }

  // ── Recognition ─────────────────────────────────────────────────────────────────────────────────
  const stopRecognition = () => {
    if (!rec) return
    try { rec.abort() } catch { /* already stopped */ }
    rec = null
  }

  const startRecognition = () => {
    const Ctor = RecognitionCtor()
    if (!Ctor) return
    stopRecognition()
    const r = new Ctor()
    r.continuous = true
    r.interimResults = true
    r.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US'
    r.onresult = (e) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const t = res[0]?.transcript ?? ''
        if (res.isFinal) final += t; else interim += t
      }
      if (final) heard = (heard ? `${heard} ` : '') + final.trim()
      opts.onHeard((heard + (interim ? ` ${interim}` : '')).trim() || null)
    }
    r.onerror = () => { /* no-speech / denied: VAD still ends the turn */ }
    r.onend = () => { /* VAD owns the turn; recognition ending early is not a turn boundary */ }
    rec = r
    try { r.start() } catch { /* already started, or refused */ }
  }

  // ── Turns ───────────────────────────────────────────────────────────────────────────────────────
  const openTurn = () => {
    if (stopped) return
    clearTimers()
    heard = ''
    opts.onHeard(null)
    rudi.listen()
    startRecognition()
    // No recognition at all: nothing would otherwise end the turn but VAD, which is fine — but if the
    // mic is missing too, VAD can never fire, so a pause timer is the only remaining backstop.
    if (!rec && !stream) noAsrTimer = setTimeout(() => answer(), NO_ASR_PAUSE_MS)
  }

  const armTurn = () => {
    if (stopped) return
    stopRecognition()
    voicing = false; above = 0; below = 0
    rudi.arm()
    clearTimers()
    // The mic stays open through this. The session closes only if nothing is said.
    armedTimer = setTimeout(() => { if (rudi.state() === 'armed') session.stop() }, armedMs)
  }

  const answer = () => {
    if (stopped) return
    // Recognition is paused for the whole utterance — the duplex guard's first half. The second is
    // the raised VAD threshold below.
    stopRecognition()
    clearTimers()

    const f = opts.facts()
    const text = f ? rudiReply(heard, f) : 'One moment — I am still pulling today’s numbers.'
    opts.onReply(text)

    if (!hasSynthesis()) {
      const ms = estimateMs(text)
      rudi.speak(text, ms)
      sayTimer = setTimeout(() => { rudi.stopSpeaking(); armTurn() }, ms)
      return
    }

    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.02
    // speak() is driven by the utterance's OWN onstart/onend, so the video runs for exactly as long
    // as the voice does. That is the entire point of the duration argument, and the one thing a
    // scripted timeout can never get right. The ms below is a ceiling in case onend never fires.
    u.onstart = () => { if (!stopped) rudi.speak(text, 120_000) }
    const finish = () => {
      if (stopped) return
      rudi.stopSpeaking()
      armTurn()
    }
    u.onend = finish
    u.onerror = finish
    window.speechSynthesis.speak(u)
  }

  /** Cut her off and hand the floor back. The one thing that makes this feel alive. */
  const bargeIn = () => {
    if (hasSynthesis()) { try { window.speechSynthesis.cancel() } catch { /* nothing speaking */ } }
    rudi.stopSpeaking()
    openTurn()
  }

  // ── The level, and the VAD that reads it ────────────────────────────────────────────────────────
  const pushLevel = (level: number, now: number) => {
    const st = rudi.state()
    // Raised while she speaks: echo cancellation removes most of her playback and this covers the
    // rest, so her own voice cannot open a turn — while a real interruption, louder and closer, still
    // can.
    const threshold = st === 'speaking' ? VAD_THRESHOLD_DUPLEX : VAD_THRESHOLD

    if (level > threshold) {
      below = 0
      if (!above) above = now
      if (!voicing && now - above >= VAD_START_MS) {
        voicing = true
        if (st === 'speaking') bargeIn()
        else if (st === 'armed') openTurn()
      }
    } else {
      above = 0
      if (voicing) {
        if (!below) below = now
        if (now - below >= VAD_END_MS) {
          voicing = false; below = 0
          if (rudi.state() === 'listening') answer()
        }
      }
    }
  }

  const session: VoiceSession = {
    stop() {
      if (stopped) return
      stopped = true
      clearTimers()
      stopRecognition()
      if (raf) cancelAnimationFrame(raf)
      if (hasSynthesis()) { try { window.speechSynthesis.cancel() } catch { /* nothing speaking */ } }
      if (stream) for (const t of stream.getTracks()) t.stop()
      if (audio) void audio.close().catch(() => {})
      stream = null; audio = null
      rudi.endSession()
      opts.onEnd?.()
    },
  }

  // ── Start ───────────────────────────────────────────────────────────────────────────────────────
  // The state changes FIRST, before the permission prompt, so the press has an immediate answer.
  rudi.listen()
  opts.onHeard(null)

  void (async () => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
      } catch {
        stream = null // denied: the canvas keeps its synthetic envelope and says DEMO
      }
    }
    if (stopped) { if (stream) for (const t of stream.getTracks()) t.stop(); return }

    if (stream) {
      const Ctx = window.AudioContext
        || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audio = new Ctx()
      const an = audio.createAnalyser()
      an.fftSize = 512
      an.smoothingTimeConstant = 0.4
      audio.createMediaStreamSource(stream).connect(an)
      const buf = new Uint8Array(an.fftSize)

      const tick = () => {
        if (stopped) return
        if (audio?.state === 'suspended') void audio.resume()
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
        const rms = Math.sqrt(sum / buf.length)
        // 0.006 is a noise gate; 7.5 brings ordinary speech to roughly full scale.
        const lv = Math.min(1, Math.max(0, (rms - 0.006) * 7.5))
        // Asymmetric: speech attacks far faster than it decays, and a symmetric filter either lags
        // the onset or twitches through the gaps between words.
        smoothed += (lv - smoothed) * (lv > smoothed ? 0.55 : 0.14)
        // Only ever called with a REAL level. Never calling it is what makes the canvas say DEMO.
        rudi.level(smoothed)
        pushLevel(smoothed, performance.now())
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    openTurn()
  })()

  return session
}
