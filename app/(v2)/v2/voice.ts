'use client'

// The browser-only voice loop: microphone level, transcript, reply, speech.
//
// Nothing here touches the backend. No Deepgram, no model call, no key, no dependency — the mic comes
// from getUserMedia, the transcript from the browser's own SpeechRecognition, and the voice from
// speechSynthesis. All three are optional and each degrades on its own:
//
//   no microphone        -> the meter runs the synthetic envelope and says LISTENING · DEMO
//   no SpeechRecognition -> no transcript, meter still real, reply still happens after a pause
//   no speechSynthesis   -> the reply is shown and held for a length estimated from its own text
//
// The point of the loop is that Rudi.speak(text, ms) is driven by speechSynthesis's own onstart and
// onend, so the video runs for exactly as long as the voice does. That is what the duration API is
// for, and it is the one thing a scripted timeout can never get right.

// ── Microphone ──────────────────────────────────────────────────────────────────────────────────────

export interface MicHandle {
  stop: () => void
  /** True once audio is actually flowing. False means the meter is on the synthetic envelope. */
  live: () => boolean
}

/**
 * Open the microphone and pump RMS into `onLevel` every frame.
 *
 * Asymmetric smoothing — rise 0.55, fall 0.14. Speech attacks far faster than it decays, and a
 * symmetric filter either lags the onset or makes the meter twitch through the gaps between words.
 */
export async function openMic(onLevel: (v: number) => void): Promise<MicHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
  } catch {
    return null // denied or unavailable — the caller falls back to the synthetic envelope
  }

  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ac = new Ctx()
  const an = ac.createAnalyser()
  an.fftSize = 512
  an.smoothingTimeConstant = 0.4
  ac.createMediaStreamSource(stream).connect(an)
  const buf = new Uint8Array(an.fftSize)

  let smoothed = 0
  let raf = requestAnimationFrame(function tick() {
    if (ac.state === 'suspended') void ac.resume()
    an.getByteTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
    const rms = Math.sqrt(sum / buf.length)
    // The 0.006 floor is a noise gate; 7.5 brings ordinary speech to roughly full scale.
    const lv = Math.min(1, Math.max(0, (rms - 0.006) * 7.5))
    smoothed += (lv - smoothed) * (lv > smoothed ? 0.55 : 0.14)
    onLevel(smoothed)
    raf = requestAnimationFrame(tick)
  })

  let stopped = false
  return {
    live: () => !stopped,
    stop() {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(raf)
      for (const t of stream.getTracks()) t.stop()
      void ac.close().catch(() => {})
    },
  }
}

// ── Transcript ──────────────────────────────────────────────────────────────────────────────────────

type SR = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

function SpeechRecognitionCtor(): (new () => SR) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export const hasSpeechRecognition = () => SpeechRecognitionCtor() !== null

export interface TranscriptHandle { stop: () => void }

/**
 * Live transcript. `onText` fires with the running text — interim included, so the words appear as
 * they are said rather than in a block at the end.
 *
 * `onPause` fires when the engine decides the utterance ended. That is the browser's own endpointing,
 * which is better than a timer because it knows the difference between a breath and a stop.
 */
export function listenForText(
  onText: (text: string, final: boolean) => void,
  onPause: (finalText: string) => void,
): TranscriptHandle | null {
  const Ctor = SpeechRecognitionCtor()
  if (!Ctor) return null

  const rec = new Ctor()
  rec.continuous = false
  rec.interimResults = true
  rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US'

  let text = ''
  let stopped = false

  rec.onresult = (e) => {
    let interim = ''
    let final = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      const t = r[0]?.transcript ?? ''
      if (r.isFinal) final += t; else interim += t
    }
    if (final) text = (text ? `${text} ` : '') + final.trim()
    onText((text + (interim ? ` ${interim}` : '')).trim(), !!final)
  }
  rec.onerror = () => { /* no-permission / no-speech: onend still fires and the caller replies */ }
  rec.onend = () => { if (!stopped) onPause(text.trim()) }

  try { rec.start() } catch { return null }

  return {
    stop() {
      stopped = true
      try { rec.stop() } catch { /* already stopped */ }
    },
  }
}

// ── Speech ──────────────────────────────────────────────────────────────────────────────────────────

export const hasSpeechSynthesis = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window

/**
 * Say `text`, and report when the voice actually starts and stops.
 *
 * The caller drives Rudi.speak() from `onStart` and Rudi.stopSpeaking() from `onEnd`, so the video
 * runs for exactly the length of the utterance — not an estimate of it. When synthesis is absent the
 * caller gets an estimated duration instead, which is the honest fallback: roughly 165 words/minute,
 * floored at 1.6s so a two-word answer still registers.
 */
export function say(text: string, onStart: () => void, onEnd: () => void): () => void {
  if (!hasSpeechSynthesis()) {
    const words = text.split(/\s+/).filter(Boolean).length
    const ms = Math.max(1600, (words / 165) * 60_000)
    onStart()
    const t = setTimeout(onEnd, ms)
    return () => clearTimeout(t)
  }

  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 1.02
  u.pitch = 1.0
  u.onstart = onStart
  u.onend = onEnd
  // A cancelled or failed utterance must still close the speaking state, or the video loops forever.
  u.onerror = onEnd
  window.speechSynthesis.speak(u)

  return () => { try { window.speechSynthesis.cancel() } catch { /* nothing speaking */ } }
}

/** Estimated duration, for callers that need a number before the voice starts. */
export function estimateMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.max(1600, Math.round((words / 165) * 60_000))
}

// ── Voice activity detection ────────────────────────────────────────────────────────────────────────
//
// Turn-taking is decided by the SOUND, not by a timer. A fixed timer is what makes a voice product
// feel like a phone menu: it cuts you off mid-sentence and then waits through your silence.
//
// Speech STARTS when the level holds above the threshold for ~150ms — long enough that a door closing
// or a keyboard does not open a turn. It ENDS after ~900ms below, which is longer than the pause
// inside a sentence and shorter than the pause between two of them. Those two numbers are the whole
// feel of the thing.
//
// The threshold is a FUNCTION rather than a constant so the caller can raise it while she is
// speaking. That is the duplex guard: echo cancellation removes most of her playback, and a raised
// floor covers the rest, so her own voice cannot open a turn while a genuine interruption still can.

export const VAD_START_MS = 150
export const VAD_END_MS = 900

/** Ordinary speech sits well above this; room tone sits below it. */
export const VAD_THRESHOLD = 0.055
/** While she is speaking. Above what leaks past echo cancellation, below a real interruption. */
export const VAD_THRESHOLD_DUPLEX = 0.20

export interface Vad {
  /** Feed every level frame. Safe to call when the caller is not interested in the result. */
  push: (level: number, now: number) => void
  /** Forget any partial run — used when a turn changes under it. */
  reset: () => void
  speaking: () => boolean
}

export function createVad(opts: {
  onStart: () => void
  onEnd: () => void
  threshold: () => number
}): Vad {
  let above = 0        // when the current run above threshold began
  let below = 0        // when the current run below threshold began
  let active = false   // is a speech run currently open

  return {
    speaking: () => active,
    reset() { above = 0; below = 0; active = false },
    push(level, now) {
      const t = opts.threshold()
      if (level > t) {
        below = 0
        if (!above) above = now
        if (!active && now - above >= VAD_START_MS) { active = true; opts.onStart() }
      } else {
        above = 0
        if (active) {
          if (!below) below = now
          if (now - below >= VAD_END_MS) { active = false; below = 0; opts.onEnd() }
        }
      }
    },
  }
}
