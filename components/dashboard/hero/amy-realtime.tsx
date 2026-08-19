'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import './amy-panel.css'
import { type AmyBriefing, TTS_VOICE, buildRealtimePrompt } from './ask-amy-shared'
import { stripMarkdown } from '@/lib/utils'

const PROXY_URL = process.env.NEXT_PUBLIC_AMY_REALTIME_URL || 'ws://localhost:8081'
const DEBUG = process.env.NODE_ENV !== 'production'
/* eslint-disable no-console */
const log = (...a: unknown[]) => { if (DEBUG) console.log('%c[amy-realtime]', 'color:#5B6CF0', ...a) }
/* eslint-enable no-console */

type Phase = 'connecting' | 'live' | 'thinking' | 'speaking' | 'error'

// `onMoment` reports the moments this component ALREADY knows — the mic opening, each audio tick, her
// starting and stopping — so a host can drive its own presence with them. It is a report, not a
// behaviour: nothing here changes shape when nobody is listening, which is the case on /dashboard.
//
// `surface` only stamps data-surface for CSS. In the v2 skin the card, its chrome and the transcript
// are hidden, because the host renders her reply as the caption and her state as the portrait.
export type AmyMoment =
  | { type: 'listen' }
  | { type: 'level'; value: number }
  | { type: 'speak'; text: string; ms: number }
  | { type: 'stopSpeaking' }
  | { type: 'arm' }
  | { type: 'said'; text: string }
  | { type: 'reply'; text: string }

// `prompt` and `snapshotUrl` are how a SECOND employee uses this session without a second
// implementation of it. Absent, both default to Amy's — the dashboard assistant, unchanged. Supplied,
// the socket, the mic, the noise gate, the drain guard and every moment emitted are identical; only
// what the agent is told about itself differs. That is the whole of "persona", plus the voice id the
// briefing already carries.
export function AmyRealtime({ briefing, audioCtx, onClose, onType, onMoment, surface = 'v1', prompt, snapshotUrl = '/api/ai/amy/snapshot' }: { briefing: AmyBriefing; audioCtx?: AudioContext | null; onClose: () => void; onType: () => void; onMoment?: (m: AmyMoment) => void; surface?: 'v1' | 'v2'; prompt?: string; snapshotUrl?: string | null }) {
  // Held in a ref so emitting never re-subscribes the socket effect below.
  const momentRef = useRef<((m: AmyMoment) => void) | undefined>(onMoment)
  momentRef.current = onMoment
  // Every moment, timestamped, with the two clocks that decide whether she is still audible — and the
  // line it came from. The question is whether listen() ever fires while playHead is still ahead of
  // currentTime; if it does, the caller in the stack is what is ending her turn, not endSpeaking.
  // WHILE SHE IS AUDIBLE, THE SCREEN STAYS ON HER.
  //
  // One guard here rather than a check at each call site, so it also covers sites added later. Three
  // moments take the portrait off her — arm, listen and stopSpeaking — and none of them may be emitted
  // while scheduled audio is still ahead of the context clock.
  //
  // Two unguarded paths were doing exactly that, both triggered by USER SPEECH: UserStartedSpeaking
  // ended her turn immediately (skipping the drain entirely, which is why fixing the drain changed
  // nothing), and ConversationText role=user emitted arm() with no condition at all. This file already
  // documents why that fires falsely — its LAYER 4 noise gate exists because Rudi's own TTS echo gets
  // transcribed as user speech. The gate stops mic audio being FORWARDED; these two messages arrive
  // FROM the agent, so anything that slips through reaches both.
  //
  // A genuine barge-in still cuts her off: stopPlayback() kills the scheduled sources and zeroes the
  // play head, so this guard opens on the same tick and the turn ends. The cost is that a real
  // interruption ends a beat after the sound rather than with it — the right way round, because the
  // alternative is her own echo taking the screen off her mid-sentence.
  const TAKES_SCREEN_OFF_HER: AmyMoment['type'][] = ['arm', 'listen', 'stopSpeaking']
  const stillAudible = () => {
    const c = ctxRef.current
    return !!c && playHeadRef.current > c.currentTime + 0.05
  }

  const emit = (m: AmyMoment) => {
    if (TAKES_SCREEN_OFF_HER.includes(m.type) && stillAudible()) {
      if (DEBUG) {
        /* eslint-disable no-console */
        console.info(`%c[amy emit] ${m.type} DROPPED — she is still audible`, 'color:#ffb020', {
          aheadBy: +(playHeadRef.current - (ctxRef.current?.currentTime ?? 0)).toFixed(3),
        })
        /* eslint-enable no-console */
      }
      return
    }
    if (DEBUG && m.type !== 'level') {
      const c = ctxRef.current
      const ahead = c ? +(playHeadRef.current - c.currentTime).toFixed(3) : null
      const from = (new Error().stack || '').split('\n')[2]?.trim().replace(/^at\s+/, '') ?? '?'
      /* eslint-disable no-console */
      console.info(
        `%c[amy emit] ${m.type}`,
        ahead !== null && ahead > 0.05 ? 'color:#ff2e93;font-weight:600' : 'color:#8b5cf6',
        { t: Math.round(performance.now()), ctxTime: c ? +c.currentTime.toFixed(3) : null, playHead: +playHeadRef.current.toFixed(3), aheadBy: ahead, from },
      )
      /* eslint-enable no-console */
    }
    momentRef.current?.(m)
  }
  // Her latest transcript, for the speak() ceiling — the audio start carries no text.
  const replyRef = useRef('')

  // Whether speak() has been emitted for THIS turn. Both entry points guard on it, so whichever
  // happens first wins and the other is a no-op.
  //
  // Deliberately not agentSpeakingRef: that ref also gates barge-in (it decides whether an incoming
  // user frame is an interruption), and setting it from the audio path would change when a barge-in
  // counts as real. This ref reports one thing — "the host has been told she started" — so it cannot
  // move any behaviour but the portrait.
  const speakEmittedRef = useRef(false)
  const tornDownRef = useRef(false)
  // Held in refs so the timers below never re-subscribe the socket effect.
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hiddenRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closingRef = useRef(false)   // her last word is still coming; end when it lands
  const clearIdle = () => { if (idleRef.current) { clearTimeout(idleRef.current); idleRef.current = null } }
  const clearHidden = () => { if (hiddenRef.current) { clearTimeout(hiddenRef.current); hiddenRef.current = null } }

  // The one place the host is told she has begun. `ms` is a CEILING: ConversationText for the
  // assistant reliably lands before her audio, so replyRef holds the sentence by now, and
  // AgentAudioDone is what really ends it — a dropped end event cannot strand her mid-word.
  // The END of her turn, driven by the audio, not by the event.
  //
  // AgentAudioDone means the SERVER finished sending. The browser is still draining a queue of
  // scheduled buffers at that moment, so ending on the event returned the portrait to listening while
  // she was audibly still talking. playHead is the time the last scheduled buffer runs out; when it
  // falls behind the context clock the sound has genuinely stopped.
  const drainRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const clearDrain = () => { if (drainRef.current) { clearInterval(drainRef.current); drainRef.current = null } }
  const endSpeaking = () => {
    clearDrain()
    if (!speakEmittedRef.current) return
    const finish = () => {
      clearDrain()
      clearTick()
      speakEmittedRef.current = false
      emit({ type: 'stopSpeaking' })
      emit({ type: 'listen' })
      if (closingRef.current) { endSession('you said goodbye'); return }
      // THE ONLY PLACE THE CLOCK STARTS. Her audio has drained, the mic is open, and it is the owner's
      // turn — the one state where silence means a question is going unanswered.
      armIdle()
    }
    const ctx = ctxRef.current
    if (!ctx) { finish(); return }
    if (playHeadRef.current <= ctx.currentTime) { finish(); return }
    drainRef.current = setInterval(() => {
      const c = ctxRef.current
      // No context, or the queue has run out: either way she has stopped.
      if (!c || playHeadRef.current <= c.currentTime) finish()
    }, 60)
  }
  useEffect(() => () => { clearDrain(); clearTick() }, [])

  // A backgrounded tab holding an open microphone is the worst case on this list, so it is the
  // shortest fuse. Returning to the tab cancels it.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        clearHidden()
        hiddenRef.current = setTimeout(() => endSession(`tab hidden for ${HIDDEN_END_MS / 1000}s`), HIDDEN_END_MS)
      } else clearHidden()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); clearHidden() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Unmount — which is what a route change is. This runs in ADDITION to the socket effect's own
  // cleanup, and teardown is idempotent, so the belt and the braces cost nothing. Without it a
  // reordering of the effects above could silently drop the only teardown on navigation.
  useEffect(() => () => { teardown('unmounted') }, [])

  // A tab being closed or reloaded never runs React cleanup. This is best-effort by nature — the
  // browser may kill the page first — but the socket close is a single frame's work.
  useEffect(() => {
    const bye = () => teardown('page unloaded')
    window.addEventListener('pagehide', bye)
    return () => window.removeEventListener('pagehide', bye)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // THE CEILING IS A SAFETY NET, NOT AN END.
  //
  // It was being enforced as one. speak(ms) arms a timer in the canvas that returns her to idle when it
  // expires, and the ms came from replyRef — which at the first PCM packet is usually empty or a stale
  // fragment, so Math.max floored it at 1500. A five-second sentence therefore animated for exactly
  // 1.5s: "armed -> speaking" then "speaking -> idle" 1500ms later, in the log, every time.
  //
  // The fix is not a better guess from the text. The scheduled audio already knows precisely how much
  // of her is left — playHead minus the context clock IS the remaining duration — so the ceiling is
  // refreshed from it while she talks. It can then only expire if the audio has genuinely run out and
  // the real stopSpeaking() was lost, which is the only thing a safety net is for.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const clearTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }

  const moment = (m: AmyMoment) => emit(m)

  // ── WHEN A SESSION ENDS ITSELF ──────────────────────────────────────────────────────────────────
  //
  // An open socket costs tokens and an open mic is worse: the tab can be behind another window with
  // the microphone live and nothing on screen to say so. Four conditions, all cheap and none of them
  // a model call.

  // THE CLOCK RUNS WHENEVER NOBODY IS SPEAKING.
  //
  // It does not need to know whose turn it is. Speech from either side stops it; the end of speech
  // from either side starts it. One rule covers every case: her question going unanswered, a greeting
  // that never came, and a connection where nobody said anything at all.
  //
  // The version before this restarted the clock ON speech rather than stopping it, which made it a
  // session-age timer — it expired mid-conversation. The one before that armed only when her turn
  // ended, which left a silent session open forever.
  const IDLE_END_MS = 10_000
  /** A backgrounded tab holding a mic. Shorter than idle, because nobody is watching. */
  const HIDDEN_END_MS = 30_000

  const armIdle = () => {
    clearIdle()
    idleRef.current = setTimeout(() => endSession(`no speech for ${IDLE_END_MS / 1000}s`), IDLE_END_MS)
  }
  /** Someone is talking. Nothing is idle, so the clock stops until they finish. */
  const speechStarted = () => clearIdle()

  // Closing intent, matched on the owner's own words. Deliberately a string test and not a model call:
  // this decides whether to hang up, and a wrong end is far cheaper to recover from than a wrong
  // charge. Anchored to the whole line so "thanks for booking that, can you also…" does not match.
  const CLOSERS = [
    /^(ok(ay)?|alright|right)?[\s,]*(thanks|thank you|thankyou|cheers|ta)[\s.!,]*$/i,
    /^(that'?s (all|it|everything)|nothing else|no(thing)? more|i'?m (all )?(good|done|set)|all good|we'?re good)[\s.!,]*$/i,
    /^(bye|goodbye|good ?night|see you|see ya|talk (to you )?(soon|later)|later|catch you later)[\s.!,]*$/i,
    /^(ok(ay)?|alright)?[\s,]*(thanks|thank you)[\s,]*(bye|goodbye|see you|talk soon)[\s.!,]*$/i,
  ]
  const soundsFinal = (t: string) => CLOSERS.some((r) => r.test(t.trim()))

  /** Milliseconds of audio still scheduled, plus a margin so the net never lands on the last sample. */
  const remainingMs = () => {
    const c = ctxRef.current
    if (!c) return 0
    return Math.max(0, Math.round((playHeadRef.current - c.currentTime) * 1000))
  }

  const beginSpeaking = () => {
    if (speakEmittedRef.current) return
    speakEmittedRef.current = true
    speechStarted()
    const t = replyRef.current
    // At the first packet almost nothing is scheduled yet and the transcript may not have arrived, so
    // the opening ceiling is deliberately generous. It is refined below within one tick.
    const fromText = t ? t.length * 75 : 0
    emit({ type: 'speak', text: t, ms: Math.min(30_000, Math.max(8_000, fromText, remainingMs() + 1_500)) })

    clearTick()
    tickRef.current = setInterval(() => {
      if (!speakEmittedRef.current) { clearTick(); return }
      const left = remainingMs()
      if (left <= 0) return // endSpeaking's drain owns the ending; the net stays out of it
      // Re-arming speak() resets the canvas's timer, so the ceiling tracks the audio instead of a guess.
      emit({ type: 'speak', text: replyRef.current, ms: Math.min(30_000, left + 1_500) })
    }, 500)
  }
  const name = briefing.employeeName || 'Amy'
  const [phase, setPhase] = useState<Phase>('connecting')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [userText, setUserText] = useState('')
  const [amyText, setAmyText] = useState('')
  // A real action the voice agent drafted / is executing (with verbal confirmation).
  const [voiceAction, setVoiceAction] = useState<{ id?: string; label: string; body: string; status: 'draft' | 'sending' | 'sent' | 'failed'; error?: string } | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const ownsCtxRef = useRef(false) // true only if WE created the context (vs. borrowed from parent)
  const streamRef = useRef<MediaStream | null>(null)
  const procRef = useRef<ScriptProcessorNode | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const playHeadRef = useRef(0)
  const connectedRef = useRef(false)

  // ── Barge-in noise gate (client, LAYER 4) ─────────────────────────────────────────
  // False barge-in happens when low-energy noise (AC hum, traffic) OR Rudi's own TTS echo
  // reaches Flux and gets transcribed as user speech, firing StartOfTurn → interruption.
  // While Rudi is speaking we forward mic audio to the agent ONLY when it clears an
  // adaptive noise floor for a sustained ~280ms — so noise/echo never reaches Flux and can
  // never trigger a false interrupt. When Rudi is silent, we stream normally (zero added
  // latency to ordinary turn-taking). A short pre-roll preserves the word onset so real
  // barge-in still lands within ~0.5s.
  const agentSpeakingRef = useRef(false)      // Rudi's turn is producing/scheduled audio
  const floorRef = useRef(0.003)              // adaptive ambient/echo RMS floor
  const gateOpenRef = useRef(false)           // a real barge-in is in progress
  const sustainRef = useRef(0)                // ms of continuous above-floor energy
  const hangoverRef = useRef(0)               // ms to keep the gate open after energy dips
  const prerollRef = useRef<Int16Array[]>([]) // recent frames, flushed on open (word onset)
  const resetGate = () => { gateOpenRef.current = false; sustainRef.current = 0; hangoverRef.current = 0; prerollRef.current = [] }

  // Latency timeline (dev console only): speech end → first audible word.
  const tRef = useRef<Record<string, number>>({})
  const reportedRef = useRef(false)
  function mk(k: string) { if (tRef.current[k] === undefined) tRef.current[k] = performance.now() }
  function reportTimeline() {
    if (!DEBUG || reportedRef.current) return
    reportedRef.current = true
    const t = tRef.current
    const base = t.userEndpoint ?? t.userStartedSpeaking ?? t.micFirstSent
    if (base === undefined) return
    const order = ['micFirstSent', 'userStartedSpeaking', 'userEndpoint', 'agentFirstTranscript', 'firstAudioPacket', 'firstAudioPlayed']
    const rows = order.filter((k) => t[k] !== undefined).map((k) => ({ stage: k, 'ms from speech-end': Math.round(t[k] - base) }))
    /* eslint-disable no-console */
    console.groupCollapsed(`%c⏱ LIVE turn — speech-end → first audible word: ${t.firstAudioPlayed !== undefined ? Math.round(t.firstAudioPlayed - base) : 'n/a'} ms`, 'color:#5B6CF0;font-weight:600')
    console.table(rows)
    console.groupEnd()
    /* eslint-enable no-console */
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const tapT0 = performance.now()
        // Prefer the AudioContext already unlocked inside the user's tap (mobile autoplay
        // policy); only create one here as a fallback (e.g. desktop deep-links). We close
        // it on teardown ONLY if we created it — never the parent's borrowed context.
        let ctx = audioCtx
        if (!ctx || ctx.state === 'closed') {
          ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
          ownsCtxRef.current = true
        }
        ctxRef.current = ctx
        // Best-effort resume; it's already unlocked in the tap, so never block mic/WS setup.
        ctx.resume().catch(() => {})

        // LAYER 1 — from the instant the mic opens, every frame is buffered here until the
        // agent is ready, then flushed in order. Nothing said during setup is lost (~10s cap).
        const buffered: ArrayBufferLike[] = []
        let agentReady = false
        let vibrated = false

        // LAYER 2 — mic, socket, and the data snapshot all start in PARALLEL from the tap.
        // The socket needs no stream, so it connects immediately (not after getUserMedia).
        const snapshotPromise = (async () => {
          // Null = this employee's brief already contains everything it should know, and the
          // dashboard's snapshot would be somebody else's job description.
          if (!snapshotUrl) return ''
          try { const r = await fetch(snapshotUrl); if (r.ok) return ((await r.json()).snapshot || '') as string } catch { /* fine without it */ }
          return ''
        })()

        // WL prepaid billing pre-flight — authorize this realtime session before any billable Deepgram
        // usage. A paused/depleted partner gets 402 → we abort before sending `config` (no session opens).
        // On success we receive a short-lived token the proxy verifies before configuring the agent.
        // Runs in parallel with mic/socket setup so a funded partner sees no added latency.
        const authPromise = (async (): Promise<{ status: number; token: string | null }> => {
          try { const r = await fetch('/api/ai/amy/realtime-auth', { method: 'POST' }); return { status: r.status, token: r.ok ? ((await r.json()).token ?? null) : null } }
          catch { return { status: 0, token: null } } // network hiccup → the proxy's token check still guards when configured
        })()

        // PROBE — the socket's LIFECYCLE, not only its messages.
        //
        // The first version of this only recorded frames, which assumed the socket connects. It did
        // not, and the result was a silent console and no window.__amyProbe at all — which is
        // indistinguishable from "the code did not deploy". These four lines make the failure say
        // WHERE it stopped: no `connect` line means the component never mounted, a `connect` with no
        // `open` means the proxy is unreachable or the URL is wrong, and a bare localhost URL on an
        // https page throws before any of it.
        console.info('%c[amy probe] connect', 'color:#D9F224', PROXY_URL)
        ;(window as unknown as { __amyProbe?: unknown }).__amyProbe = { url: PROXY_URL, stage: 'connecting', n: 0, counts: {}, samples: [] }

        const ws = new WebSocket(PROXY_URL)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        // Mic capture + buffering begins the moment the stream resolves — independent of the
        // socket (getUserMedia runs in parallel with the connect above).
        void (async () => {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
          if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
          streamRef.current = stream
          const source = ctx.createMediaStreamSource(stream)
          const proc = ctx.createScriptProcessor(2048, 1, 1)
          procRef.current = proc
          const maxChunks = Math.max(1, Math.ceil(10000 / ((1000 * 2048) / ctx.sampleRate))) // ~10s buffer cap
          proc.onaudioprocess = (e) => {
            if (cancelled) return
            const f32 = e.inputBuffer.getChannelData(0)
            const i16 = new Int16Array(f32.length)
            let sum = 0
            for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; sum += s * s }
            const rms = Math.sqrt(sum / f32.length)

            // THE METER FOLLOWS WHOEVER IS TALKING.
            //
            // level() was fed only from enqueuePcm — HER audio, arriving from the agent — so while the
            // owner spoke there was no real source and the meter moved on nothing. This is the same
            // outbound stream already open and already forwarded below; the RMS on the line above is
            // computed for the noise gate and read here as well. No second capture, and nothing about
            // what the gate forwards is changed.
            //
            // Her audio keeps the meter while she speaks: this yields to it rather than fighting it,
            // because both would otherwise write the same value on alternating frames.
            if (!speakEmittedRef.current) {
              // RMS, not peak: this is a continuous stream rather than her discrete packets, and RMS is
              // what the gate already measures. Conversational speech sits near 0.02–0.1, so the gain is
              // larger than the peak-based one used for her side.
              const MIC_GAIN = 22
              moment({ type: 'level', value: Math.min(1, rms * MIC_GAIN) })
            }

            const frameMs = (1000 * f32.length) / ctx.sampleRate
            // Forward live once the agent is ready; until then buffer (LAYER 1).
            const emit = (buf: ArrayBufferLike) => {
              if (agentReady && ws.readyState === WebSocket.OPEN) ws.send(buf)
              else { buffered.push(buf); if (buffered.length > maxChunks) buffered.shift() }
              if (tRef.current.micFirstSent === undefined) mk('micFirstSent')
            }

            // Rudi is audibly speaking while her turn is active OR buffered audio is still
            // scheduled (AgentAudioDone can arrive before the tail finishes playing).
            const speaking = agentSpeakingRef.current || playHeadRef.current > ctx.currentTime + 0.05

            if (!speaking) {
              // Normal turn-taking: stream everything (zero added latency), keep the ambient
              // noise floor fresh from these quiet frames.
              floorRef.current = Math.max(0.0012, floorRef.current * 0.95 + rms * 0.05)
              if (gateOpenRef.current || sustainRef.current || prerollRef.current.length) resetGate()
              emit(i16.buffer)
              return
            }

            // Rudi IS speaking → gate the outbound mic (LAYER 4). Only sustained, above-floor
            // energy (a deliberate interruption) is forwarded; low-energy noise + Rudi's own
            // TTS echo are dropped and never reach Flux, so they can't fire a false StartOfTurn.
            const floor = Math.max(0.0015, floorRef.current)
            const openThresh = floor * 3.5  // ~+11 dB over ambient/echo
            const quietThresh = floor * 2.0
            if (gateOpenRef.current) {
              if (rms < quietThresh) { hangoverRef.current -= frameMs; if (hangoverRef.current <= 0) resetGate() }
              else hangoverRef.current = 500
              emit(i16.buffer)
              return
            }
            // Buffer a short pre-roll so the word onset survives when we open.
            prerollRef.current.push(i16)
            while (prerollRef.current.length * frameMs > 200) prerollRef.current.shift()
            if (rms > openThresh) {
              sustainRef.current += frameMs
              if (sustainRef.current >= 280) {
                gateOpenRef.current = true; hangoverRef.current = 500
                log('barge-in gate OPEN — rms', rms.toFixed(4), '> floor', floor.toFixed(4), '(LAYER 4 client gate)')
                for (const p of prerollRef.current) emit(p.buffer)
                prerollRef.current = []
              }
            } else {
              // Below threshold: the echo/noise we suppress — decay sustain, adapt floor up.
              sustainRef.current = Math.max(0, sustainRef.current - frameMs)
              floorRef.current = Math.max(0.0012, floorRef.current * 0.97 + rms * 0.03)
            }
          }
          const mute = ctx.createGain(); mute.gain.value = 0
          source.connect(proc); proc.connect(mute); mute.connect(ctx.destination)
        })().catch((err: DOMException) => {
          // Mic acquisition failed (denied / unavailable) — existing error handling.
          if (err?.name === 'NotAllowedError') setErrorMsg(`Microphone access is off — allow the mic to talk to ${name}.`)
          else setErrorMsg('Could not start the live conversation.')
          setPhase('error')
        })

        // When the socket opens, send config (snapshot already fetched in parallel), then
        // FLUSH everything the mic captured during setup and continue live (LAYER 1/2).
        ws.onopen = async () => {
          probe.stage = 'open'
          console.info('%c[amy probe] socket open', 'color:#22D3EE')
          connectedRef.current = true
          log('proxy open', Math.round(performance.now() - tapT0), 'ms')
          const [snapshot, auth] = await Promise.all([snapshotPromise, authPromise])
          if (cancelled || ws.readyState !== WebSocket.OPEN) return
          // Billing gate: a definitive 402 means the partner is paused — never send config (no Deepgram
          // session, no cost). Any other outcome proceeds; the proxy re-checks the token server-side.
          if (auth.status === 402) {
            setErrorMsg('Live voice is unavailable right now.')
            setPhase('error')
            try { ws.close() } catch { /* noop */ }
            return
          }
          ws.send(JSON.stringify({
            type: 'config',
            voice: TTS_VOICE(briefing.employeeVoice),
            prompt: (prompt ?? buildRealtimePrompt(briefing)) + (snapshot ? `\n\nCURRENT BUSINESS DATA (real, this business only — answer from it, never say you lack access):\n${snapshot}` : ''),
            // No spoken greeting — open straight into Listening so the user can talk immediately.
            greeting: '',
            inputSampleRate: ctx.sampleRate,
            eot: 0.7,
            authToken: auth.token,
          }))
          agentReady = true
          for (const b of buffered) ws.send(b)
          log('agent ready', Math.round(performance.now() - tapT0), 'ms — flushed', buffered.length, 'buffered chunks')
          buffered.length = 0
        }

        // ── PROBE — TEMPORARY, AND DELETE IT ONCE THE QUESTION IS ANSWERED ────────────────────────
        //
        // THE QUESTION: does this socket ever send PARTIAL user speech, or only the settled turn?
        //
        // The listening state being designed shows the owner's own words arriving as they say them.
        // The only user text this file consumes is ConversationText at the endpoint — one message,
        // whole utterance, ~700ms after they stop — and the switch below has NO default, so any
        // other event Deepgram emits has been arriving and being dropped in silence since this was
        // written. The proxy forwards every frame, so if partials exist they are already reaching
        // this line.
        //
        // console.info rather than log(): DEBUG is `NODE_ENV !== 'production'`, which is false on a
        // deployed preview — and a preview is the only place a real microphone and a real session
        // meet. A probe that prints nothing where it has to run is not a probe.
        const probe = (window as unknown as { __amyProbe: { url: string; stage: string; n: number; counts: Record<string, number>; samples: unknown[] } }).__amyProbe
        const HANDLED = new Set(['Welcome', 'SettingsApplied', 'UserStartedSpeaking', 'ConversationText',
          'AgentStartedSpeaking', 'AgentAudioDone', 'FunctionCallRequest', 'Error', 'Warning'])

        ws.onmessage = (ev) => {
          if (typeof ev.data !== 'string') { mk('firstAudioPacket'); enqueuePcm(new Int16Array(ev.data as ArrayBuffer)); return }
          let msg: { type?: string; role?: string; content?: string; description?: string; functions?: { id: string; name: string; arguments?: string }[] }
          try { msg = JSON.parse(ev.data) } catch { return }

          probe.n++
          const kind = String(msg.type ?? '(no type)')
          probe.counts[kind] = (probe.counts[kind] ?? 0) + 1
          // The first few of each kind, stamped, so the ORDER is readable — a partial would show as
          // several of one type arriving before the endpoint rather than one after it.
          if (probe.counts[kind] <= 6) probe.samples.push({ ms: Math.round(performance.now() - tapT0), raw: ev.data.slice(0, 300) })
          // Everything unhandled, and every ConversationText in full — a partial could equally be a
          // field on the message this file already reads and ignores (is_final, and friends).
          if (!HANDLED.has(kind)) console.info('%c[amy probe] UNHANDLED', 'color:#FF2E93', kind, ev.data.slice(0, 400))
          else if (kind === 'ConversationText') console.info('%c[amy probe] ConversationText', 'color:#22D3EE', ev.data.slice(0, 400))
          ;(window as unknown as { __amyProbe?: unknown }).__amyProbe = probe

          switch (msg.type) {
            case 'Welcome': case 'SettingsApplied':
              setPhase('live'); emit({ type: 'listen' }); armIdle()
              // LAYER 3 — honest transition: only now flip to "Listening" + buzz the user.
              if (!vibrated) { vibrated = true; try { navigator.vibrate?.(30) } catch { /* unsupported */ }; log('tap → agent-ready', Math.round(performance.now() - tapT0), 'ms') }
              break
            case 'UserStartedSpeaking':
              speechStarted()
              tRef.current = { micFirstSent: tRef.current.micFirstSent ?? performance.now(), userStartedSpeaking: performance.now() }
              reportedRef.current = false
              agentSpeakingRef.current = false // real barge-in landed; back to normal streaming
              // Her turn is over, whether or not it finished. Without this the guard stays latched and
              // every later turn is silent to the portrait.
              // Barge-in: cut the sound first. stopPlayback() zeroes the play head, so the guard in
              // emit() opens and endSpeaking's drain completes on its own tick. No `immediate` path —
              // that one skipped the drain and was itself the bug.
              stopPlayback(); endSpeaking(); setPhase('thinking'); break
            case 'ConversationText':
              if (msg.role === 'user') {
                mk('userEndpoint'); setUserText(msg.content || ''); setPhase('thinking')
                emit({ type: 'said', text: msg.content || '' }); emit({ type: 'arm' })
                armIdle()
                // She gets her last word out first: the flag is honoured once her audio has drained.
                if (soundsFinal(msg.content || '')) closingRef.current = true
              }
              // Stripped for display too. The prompt tells the agent not to format, but its words are
              // spoken by Deepgram before we ever see them — so if one slips through, at least the
              // owner doesn't also read the asterisks on screen.
              else if (msg.role === 'assistant') { mk('agentFirstTranscript'); const t = stripMarkdown(msg.content || ''); setAmyText(t); replyRef.current = t; emit({ type: 'reply', text: t }) }
              break
            case 'AgentStartedSpeaking':
              agentSpeakingRef.current = true; resetGate(); setPhase('speaking')
              beginSpeaking()
              break
            case 'AgentAudioDone':
              // The server has stopped sending. She has not stopped talking — endSpeaking waits for
              // the scheduled audio to drain before telling the portrait.
              agentSpeakingRef.current = false
              setPhase('live'); endSpeaking(); break
            case 'FunctionCallRequest': {
              // The agent wants to perform a real action. We (authenticated browser) execute it
              // via the app API, show a status card, and return the TRUE result to the agent —
              // so it can only claim success after a real 'executed' result.
              const fns = msg.functions || []
              ;(async () => {
                for (const fn of fns) {
                  let args: Record<string, string> = {}
                  try { args = JSON.parse(fn.arguments || '{}') } catch { /* not JSON */ }
                  let content = 'Unknown function.'
                  try {
                    if (fn.name === 'request_action') {
                      const r = await fetch('/api/assistant/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_type: args.action_type, target: args.target, body: args.body }) })
                      const d = await r.json()
                      if (d.status === 'drafted') {
                        setVoiceAction({ id: d.id, label: d.label || 'Action', body: d.body || args.body || '', status: 'draft' })
                        content = `Drafted (action_id=${d.id}). Read the owner your draft and ask if you should send it. Do NOT say it was sent yet. Draft: "${d.body || args.body || ''}"`
                      } else {
                        setVoiceAction(null)
                        content = `ACTION_BLOCKED: ${d.reason} — tell the owner this exactly; do not claim it was done.`
                      }
                    } else if (fn.name === 'execute_action') {
                      setVoiceAction((p) => (p ? { ...p, status: 'sending' } : p))
                      const r = await fetch(`/api/assistant/actions/${args.action_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }) })
                      const d = await r.json()
                      if (r.ok && d.ok) { setVoiceAction((p) => (p ? { ...p, status: 'sent' } : p)); content = 'Sent successfully.' }
                      else { const err = d.error || 'The action failed. Please try again.'; setVoiceAction((p) => (p ? { ...p, status: 'failed', error: err } : p)); content = `Failed: ${err}` }
                    }
                  } catch (e) { content = `Failed: ${(e as Error).message}` }
                  try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'FunctionCallResponse', id: fn.id, name: fn.name, content })) } catch { /* noop */ }
                }
              })()
              break
            }
            case 'Error': case 'Warning':
              log(msg.type, msg.description)
              if (msg.type === 'Error') { setErrorMsg('Live voice is unavailable right now.'); setPhase('error') }
              break
          }
        }
        ws.onerror = () => {
          probe.stage = 'error'
          console.info('%c[amy probe] socket error', 'color:#FF2E93', 'never opened:', !connectedRef.current)
          if (!connectedRef.current) { setErrorMsg('Live voice is unavailable right now.'); setPhase('error') }
        }
        ws.onclose = () => {
          // One line to paste back. See the probe note above; delete with it.
          probe.stage = 'closed'
          console.info('%c[amy probe] SUMMARY', 'color:#D9F224', 'url', probe.url, 'frames', probe.n, JSON.stringify(probe.counts), probe.samples)
          if (!connectedRef.current) { setErrorMsg('Live voice is unavailable right now.'); setPhase('error') }
          else if (!cancelled) setPhase((p) => (p === 'error' ? p : 'live'))
        }
      } catch (e) {
        const err = e as DOMException
        if (err?.name === 'NotAllowedError') setErrorMsg(`Microphone access is off — allow the mic to talk to ${name}.`)
        else setErrorMsg('Could not start the live conversation.')
        setPhase('error')
      }
    })()
    return () => { cancelled = true; teardown('effect cleanup') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function enqueuePcm(int16: Int16Array) {
    const ctx = ctxRef.current
    if (!ctx || int16.length === 0) return
    // The level the host's meter renders. Peak of this packet, normalised — the packet is already here
    // and already decoded; this reads it, it does not resample or analyse anything.
    let peak = 0
    for (let i = 0; i < int16.length; i += 16) { const a = Math.abs(int16[i]); if (a > peak) peak = a }
    // peak/32768 is the mathematically honest fraction of full scale and the wrong number to send.
    // Conversational speech peaks around a tenth to a third of full scale, so the meter sat near zero
    // and its 52 segments rendered as a dotted rule — what looked like the old drawing was the new one,
    // starved. GAIN maps a normal speaking voice across most of the meter's range; the clamp lets a
    // loud passage flatten at the top rather than distort the shape below it.
    const GAIN = 6
    emit({ type: 'level', value: Math.min(1, (peak / 32768) * GAIN) })
    // Her voice IS these packets. AgentStartedSpeaking is not in this agent's stream — the log had
    // stopSpeaking on every turn and never one speak — so binding to the event whose name matched the
    // concept bound to nothing. This is the moment; it fires whatever the control events are called.
    beginSpeaking()
    const buf = ctx.createBuffer(1, int16.length, 24000)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    const start = Math.max(ctx.currentTime + 0.01, playHeadRef.current)
    src.start(start)
    if (tRef.current.firstAudioPlayed === undefined) { mk('firstAudioPlayed'); reportTimeline() }
    playHeadRef.current = start + buf.duration
    sourcesRef.current.push(src)
    src.onended = () => { sourcesRef.current = sourcesRef.current.filter((s) => s !== src) }
  }
  function stopPlayback() { for (const s of sourcesRef.current) { try { s.stop() } catch { /* noop */ } } sourcesRef.current = []; playHeadRef.current = 0 }
  // Teardown REPORTS what it released. A session that ended in the UI while the socket stayed open is
  // indistinguishable from one that ended properly unless the release is observable, and that gap is
  // exactly what leaves a microphone live without anyone knowing.
  function teardown(reason = 'closed') {
    if (tornDownRef.current) return
    tornDownRef.current = true
    clearDrain(); clearTick(); clearIdle(); clearHidden()
    stopPlayback()
    try { procRef.current?.disconnect() } catch { /* noop */ }

    const ws = wsRef.current
    const wsState = ws ? ws.readyState : -1
    try { ws?.close() } catch { /* noop */ }

    const tracks = streamRef.current?.getTracks() ?? []
    tracks.forEach((t) => t.stop())
    const live = tracks.filter((t) => t.readyState === 'live').length

    // A context we created is closed. A BORROWED one is suspended, not closed: the parent reuses it
    // across sessions and closing it would kill the next one — but leaving it running holds an audio
    // graph open, so suspend is the honest middle. Both are logged with what actually happened.
    const ctx = ctxRef.current
    let ctxAction = 'none'
    if (ctx && ctx.state !== 'closed') {
      if (ownsCtxRef.current) { ctxAction = 'closed'; try { ctx.close().catch(() => {}) } catch { /* noop */ } }
      else { ctxAction = 'suspended (borrowed)'; try { ctx.suspend().catch(() => {}) } catch { /* noop */ } }
    }

    /* eslint-disable no-console */
    console.info(
      `%c[amy session] ENDED — ${reason}`,
      live > 0 ? 'color:#ff5c6c;font-weight:600' : 'color:#0f9d58;font-weight:600',
      { socketWas: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][wsState] ?? 'none', socketNow: ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] : 'none',
        micTracks: tracks.length, stillLive: live, audioContext: ctxAction },
    )
    /* eslint-enable no-console */
  }

  // Ending is teardown AND returning the UI to idle. Either alone is the failure: teardown without
  // onClose leaves a dead panel on screen, onClose without teardown is the open microphone.
  const endSession = (reason: string) => {
    if (tornDownRef.current) return
    teardown(reason)
    onCloseRef.current()
  }

  // Open straight into "Listening…" — no "Connecting…" flash (tap → listening → speak).
  const statusLabel = phase === 'connecting' ? 'Connecting…' : phase === 'thinking' ? 'Thinking…' : phase === 'speaking' ? 'Speaking…' : phase === 'error' ? '' : 'Listening…'
  const alive = phase === 'live' || phase === 'thinking' || phase === 'speaking'

  return (
    <div className="amy-panel mx-auto w-full max-w-md text-center" data-surface={surface}>
      <div className="relative">
        <div aria-hidden="true" className="amy-bloom pointer-events-none absolute -inset-3 rounded-[32px]" />
        <div className="amy-card relative px-6 py-6 sx-animate-in">
          <button onClick={() => endSession('you pressed end')} className="amy-close absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center" aria-label="End">
            <X className="h-4 w-4" />
          </button>

          {/* Amy's living presence — the voice ring reflects her state */}
          <div className="flex flex-col items-center">
            <div className="relative inline-flex h-3 w-3">
              {phase === 'speaking' && <span aria-hidden="true" className="pointer-events-none absolute -inset-2 rounded-full sx-ring-live" />}
              {(phase === 'live' || phase === 'thinking') && <span aria-hidden="true" className="pointer-events-none absolute -inset-2 rounded-full ring-2 ring-accent/40 animate-ping" />}
            </div>

            {phase === 'error' ? (
              <>
                <p className="amy-note mt-5">{errorMsg}</p>
                <button onClick={onType} className="amy-swap mt-3">Type instead</button>
              </>
            ) : (
              <>
                <p className="amy-status mt-4 inline-flex items-center gap-2">
                  {phase === 'speaking' && (
                    <span className="flex items-end gap-[2px] h-3" aria-hidden="true">
                      {[0, 1, 2, 3].map((i) => <span key={i} className="amy-bar sx-wavebar w-[2px] h-full rounded-full" style={{ animationDelay: `${i * 0.12}s` }} />)}
                    </span>
                  )}
                  {statusLabel}
                </p>
                {(userText || amyText) && (
                  <div className="mt-3">
                    {userText && <p className="amy-said">“{userText}”</p>}
                    {amyText && <p className="amy-body mt-1">{amyText}</p>}
                  </div>
                )}
                {voiceAction && (
                  <div className="amy-act mt-3 w-full px-4 py-3 text-left">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="amy-act-title">{voiceAction.label}</span>
                      <span className="amy-label">
                        {voiceAction.status === 'draft' ? 'Say “yes” to send' : voiceAction.status === 'sending' ? 'Sending…' : voiceAction.status === 'sent' ? 'Sent ✓' : 'Failed'}
                      </span>
                    </div>
                    <p className="amy-note leading-snug">{voiceAction.body || '(no content)'}</p>
                    {voiceAction.status === 'failed' && <p className="amy-bad amy-note mt-1">{voiceAction.error}</p>}
                    {voiceAction.status === 'sent' && <p className="amy-ok amy-note mt-1">Sent successfully.</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
