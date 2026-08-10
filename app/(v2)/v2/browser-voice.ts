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
/** No microphone at all: nothing can detect the end of a turn, so a timer has to. */
const NO_MIC_TURN_MS = 6000

// ── Keeping the speaking state escapable ────────────────────────────────────────────────────────────
//
// Chrome's speechSynthesis is unreliable in two documented ways: `onend` frequently never fires, and
// the synth stops silently after roughly fifteen seconds unless it is kept alive. Either one, on its
// own, strands a state machine that hands over on `onend` alone.
//
// So there are FOUR independent ways out of speaking, and the first to arrive wins:
//
//   1. onend / onerror            the normal path
//   2. the synth reporting idle   polled; this is what actually catches a missing onend
//   3. a hard cap                 derived from the text, in case the synth lies about being busy
//   4. the canvas's own ceiling   last resort, inside the component
//
// Plus a start watchdog, because `onstart` can also go missing — and if it does, nothing would ever
// enter speaking at all.
const KEEPALIVE_MS = 10_000
const SYNTH_POLL_MS = 400
const START_WATCHDOG_MS = 2000

const log = (msg: string) => console.info(`[v2 voice] ${Math.round(performance.now())}ms ${msg}`)

/**
 * The ONLY place speechSynthesis.cancel() is called, so every one is attributable.
 *
 * `interrupted` means something cancelled while an utterance was starting, and the answer to "which
 * something" was invisible while four call sites each did it inline. The stack is printed because a
 * reason string records what the caller believed, and the stack records what actually happened.
 */
function cancelSynth(reason: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const busy = window.speechSynthesis.speaking || window.speechSynthesis.pending
  log(`cancel() reason="${reason}" busy=${busy}`)
  if (busy) console.trace('[v2 voice] cancel() stack')
  try { window.speechSynthesis.cancel() } catch { /* nothing speaking */ }
}

type SR = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error?: string; message?: string }) => void) | null
  onend: (() => void) | null
}

/**
 * Errors that mean recognition is GONE, not merely interrupted.
 *
 * Everything else — 'aborted', 'no-speech', 'network' — is transient and the instance is restarted.
 * Distinguishing them matters: treating a transient error as fatal is what silently removed the
 * transcript for the rest of the session.
 */
const FATAL_ASR = new Set(['not-allowed', 'service-not-allowed', 'audio-capture'])

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
  let recAvailable = true
  /** True only while WE are tearing it down, so its own onend is not mistaken for Chrome's. */
  let recDeliberate = false
  let heard = ''
  let smoothed = 0
  let armedTimer: ReturnType<typeof setTimeout> | null = null
  let noAsrTimer: ReturnType<typeof setTimeout> | null = null
  let sayTimer: ReturnType<typeof setTimeout> | null = null
  let startWatchdog: ReturnType<typeof setTimeout> | null = null
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let synthPoll: ReturnType<typeof setInterval> | null = null
  let started = false
  /** True from the moment a reply is begun until the floor is handed back. */
  let replying = false

  // VAD state
  let above = 0
  let below = 0
  let voicing = false

  /** Everything the speaking state owns. Called on every exit from it, including the forced ones. */
  const stopSpeechWatchers = () => {
    if (keepAlive) { clearInterval(keepAlive); keepAlive = null }
    if (synthPoll) { clearInterval(synthPoll); synthPoll = null }
    if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null }
    if (sayTimer) { clearTimeout(sayTimer); sayTimer = null }
    started = false
  }

  const clearTimers = () => {
    if (armedTimer) { clearTimeout(armedTimer); armedTimer = null }
    if (noAsrTimer) { clearTimeout(noAsrTimer); noAsrTimer = null }
    stopSpeechWatchers()
  }

  // ── Recognition: ONE instance for the whole session ──────────────────────────────────────────
  //
  // It used to be started and abort()ed per turn. abort() raises an error event — the log showed it
  // landing 4ms after speak(), every single time she spoke — and that error killed the transcript for
  // the rest of the session. The pause meant to stop her voice being transcribed was destroying the
  // thing it was protecting.
  //
  // Now it starts once and stays up. Her voice is kept out by IGNORING results while she has the
  // floor, not by tearing the instance down. It is aborted in exactly one place: session stop.
  const stopRecognition = () => {
    if (!rec) return
    recDeliberate = true
    try { rec.abort() } catch { /* already stopped */ }
    rec = null
  }

  const startRecognition = () => {
    const Ctor = RecognitionCtor()
    if (!Ctor || !recAvailable || stopped) return
    const r = new Ctor()
    r.continuous = true
    r.interimResults = true
    r.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US'

    r.onresult = (e) => {
      // The duplex guard for the TRANSCRIPT. While she has the floor her own audio may reach the
      // recogniser; those words are hers, not the caller's, and they are dropped rather than
      // appended. This replaces tearing the instance down.
      if (rudi.state() !== 'listening') return
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

    r.onerror = (e) => {
      const reason = e?.error ?? 'unknown'
      log(`recognition: error=${reason}${e?.message ? ` message="${e.message}"` : ''}`)
      // NEVER a turn boundary. A recogniser failing says nothing about whose turn it is, and treating
      // it as an ending is what made the conversation bounce between armed and listening.
      if (FATAL_ASR.has(reason)) {
        recAvailable = false
        log('recognition: unavailable for the rest of this session')
      }
    }

    r.onend = () => {
      log('recognition: end')
      if (recDeliberate) { recDeliberate = false; return }
      // Chrome ends recognition on its own — after silence, and after about a minute. Restarting is
      // what "survives a full session" actually requires.
      if (!stopped && recAvailable) {
        log('recognition: restarting')
        setTimeout(() => { if (!stopped && recAvailable && !rec) startRecognition() }, 120)
      }
    }

    rec = r
    try { r.start(); log('recognition: started') } catch { /* already started */ }
  }

  // ── Turns ───────────────────────────────────────────────────────────────────────────────────────
  const openTurn = () => {
    if (stopped) return
    clearTimers()
    heard = ''
    opts.onHeard(null)
    replying = false
    log('turn: listening')
    rudi.listen()
    // Recognition is already up for the session. If Chrome dropped it and the restart has not landed
    // yet, this brings it back; it is never torn down and rebuilt per turn.
    if (!rec) startRecognition()

    // ── EVERY DEGRADED PATH MUST STILL REACH THE END OF A TURN ──────────────────────────────────
    //
    // With a microphone, VAD closes the turn. Without one there is no VAD, and the turn would hang
    // open forever — a denied permission would look exactly like the freeze this change is about.
    // Recognition's endpointing cannot serve as the boundary any more, because the instance now
    // restarts itself, so a timer is the honest fallback for a path that has no other signal.
    if (!stream) {
      noAsrTimer = setTimeout(() => {
        if (rudi.state() === 'listening') { log('turn: closed by timer (no microphone)'); answer() }
      }, recAvailable ? NO_MIC_TURN_MS : NO_ASR_PAUSE_MS)
    }
  }

  const armTurn = () => {
    if (stopped) return
    replying = false
    log('turn: armed')
    voicing = false; above = 0; below = 0
    rudi.arm()
    clearTimers()
    // The mic stays open through this. The session closes only if nothing is said.
    armedTimer = setTimeout(() => { if (rudi.state() === 'armed') session.stop() }, armedMs)
  }

  const answer = () => {
    if (stopped) return
    // ── ONE REPLY PER TURN ────────────────────────────────────────────────────────────────────────
    //
    // Without this, VAD could call answer() twice: the state stays 'listening' from here until
    // onstart, so a second silence-end lands in the same window, and the second answer() sees the
    // first utterance PENDING and cancels it. That is the error=interrupted in the log — a cancel
    // fired after speak() by answer() itself, re-entered.
    if (replying) { log('answer() ignored — a reply is already in flight') ; return }
    replying = true

    // Recognition is NOT stopped here. Its results are ignored while she has the floor (see
    // onresult), which is the same guard without the abort that used to kill the session.
    clearTimers()

    const f = opts.facts()
    const text = f ? rudiReply(heard, f) : 'One moment — I am still pulling today\u2019s numbers.'
    opts.onReply(text)

    const est = estimateMs(text)
    log(`reply "${text.slice(0, 40)}…" est=${est}ms`)

    // ONE handover, whoever gets there first. Everything below races to call this, and the guard is
    // what makes the race safe rather than a source of double-arming.
    let handed = false
    started = false
    const handOver = (why: string) => {
      if (handed || stopped) return
      handed = true
      log(`handover via ${why}`)
      stopSpeechWatchers()
      // If we got here on a timer rather than on onend, her voice may still be running. Silence it,
      // or she talks over the armed state.
      if (why !== 'onend' && hasSynthesis()) {
        cancelSynth(`handover:${why}`)
      }
      rudi.stopSpeaking()
      armTurn()
    }

    if (!hasSynthesis()) {
      log('no speechSynthesis; holding the reply for the estimated duration')
      rudi.speak(text, est + 10_000)
      sayTimer = setTimeout(() => handOver('estimate (no synthesis)'), est)
      return
    }

    // ── AUDIO AND NO-AUDIO ARE DIFFERENT STATES, AND WERE BEING CONFLATED ───────────────────────
    //
    // begin() is for an utterance that is REALLY SPEAKING. It starts the idle-poll, which asks the
    // synth "are you still busy?" — the right question when audio is playing, and a guaranteed
    // instant close when there is none. Calling it from the error path is what produced a 400ms
    // silent "reply": no audio, so the synth was idle, so the poll closed the turn one tick later.
    //
    // holdText() is for no audio at all. The reply is on screen and the turn is held for as long as
    // reading it would take. Deliberately NO poll, because there is nothing to poll.
    const begin = (why: string) => {
      if (started || stopped) return
      started = true
      log(`speaking (audio) via ${why}`)
      rudi.speak(text, est * 2 + 10_000)

      // Chrome stops the synth silently after ~15s. resume() while speaking prevents it.
      keepAlive = setInterval(() => {
        try { window.speechSynthesis.resume() } catch { /* gone */ }
      }, KEEPALIVE_MS)

      // The catch for a missing onend — confirmed present in the log. When the synth says it is no
      // longer busy and no event arrived, that IS the bug, and this is what notices.
      synthPoll = setInterval(() => {
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          handOver('synth reported idle (onend never fired)')
        }
      }, SYNTH_POLL_MS)

      sayTimer = setTimeout(() => handOver('hard cap'), est * 2 + 6000)
    }

    const holdText = (why: string) => {
      if (started || stopped || handed) return
      started = true
      log(`speaking (text only, no audio) — ${why}`)
      rudi.speak(text, est + 8000)
      sayTimer = setTimeout(() => handOver(`estimate (${why})`), est)
    }

    // ── The utterance, retryable ─────────────────────────────────────────────────────────────────
    let attempt = 0

    const speakOnce = () => {
      if (stopped || handed) return
      attempt += 1
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1.02
      log(`utterance created (attempt ${attempt})`)

      u.onstart = () => { log('event: onstart'); begin('event') }
      u.onend = () => { log('event: onend'); handOver('onend') }

      u.onerror = (e) => {
        const reason = (e as unknown as { error?: string })?.error ?? 'unknown'
        log(`event: onerror error=${reason} (attempt ${attempt}, started=${started})`)
        if (handed || stopped) return

        // An utterance that errored BEFORE producing audio never spoke. Entering speaking for it
        // claims something that did not happen — and the previous build did exactly that.
        if (!started) {
          if (attempt < 2) {
            log('retrying the utterance once')
            if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null }
            setTimeout(speakOnce, 260)
            return
          }
          holdText(`synthesis failed twice: ${reason}`)
          return
        }

        // Errored mid-speech: some audio played, so the turn had real length. End it normally.
        handOver(`onerror mid-speech: ${reason}`)
      }

      // Not used for control — boundaries arriving without onend means the utterance ran and only the
      // final event was lost, which is a different fault from never starting.
      u.onboundary = (e) => log(`event: onboundary @${Math.round(e.charIndex ?? 0)}`)

      window.speechSynthesis.speak(u)
      log('speechSynthesis.speak() called')

      // onstart can go missing too. If it does, audio may still be playing, so this enters the
      // AUDIO state — it is a missing event, not a missing voice.
      if (startWatchdog) clearTimeout(startWatchdog)
      startWatchdog = setTimeout(() => {
        if (started || stopped || handed) return
        if (window.speechSynthesis.speaking) { log('onstart never fired but the synth is speaking'); begin('watchdog') }
        else { log('onstart never fired and the synth is not speaking'); holdText('onstart never fired') }
      }, START_WATCHDOG_MS)
    }

    const fire = speakOnce

    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      cancelSynth('answer: synth was busy')
      setTimeout(fire, 140)
    } else {
      fire()
    }
  }

  /** Cut her off and hand the floor back. The one thing that makes this feel alive. */
  const bargeIn = () => {
    cancelSynth('barge-in')
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
    /**
     * Force idle from ANY state. Never waits on an event, never checks what is pending, and is safe
     * to call twice — the button, Esc and the armed timeout all land here, and none of them may be
     * blocked by an utterance that is refusing to end.
     */
    stop() {
      if (stopped) return
      stopped = true
      log('session: stop')
      clearTimers()
      stopRecognition()
      if (raf) cancelAnimationFrame(raf)
      cancelSynth('session stop')
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

    // One instance, started with the session and torn down only with it.
    startRecognition()
    openTurn()
  })()

  return session
}
