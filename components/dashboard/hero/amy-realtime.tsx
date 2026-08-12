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

export function AmyRealtime({ briefing, audioCtx, onClose, onType, onMoment, surface = 'v1' }: { briefing: AmyBriefing; audioCtx?: AudioContext | null; onClose: () => void; onType: () => void; onMoment?: (m: AmyMoment) => void; surface?: 'v1' | 'v2' }) {
  // Held in a ref so emitting never re-subscribes the socket effect below.
  const momentRef = useRef<((m: AmyMoment) => void) | undefined>(onMoment)
  momentRef.current = onMoment
  const emit = (m: AmyMoment) => momentRef.current?.(m)
  // Her latest transcript, for the speak() ceiling — AgentStartedSpeaking arrives without the text.
  const replyRef = useRef('')
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
          try { const r = await fetch('/api/ai/amy/snapshot'); if (r.ok) return ((await r.json()).snapshot || '') as string } catch { /* fine without it */ }
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
            prompt: buildRealtimePrompt(briefing) + (snapshot ? `\n\nCURRENT BUSINESS DATA (real, this business only — answer from it, never say you lack access):\n${snapshot}` : ''),
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

        ws.onmessage = (ev) => {
          if (typeof ev.data !== 'string') { mk('firstAudioPacket'); enqueuePcm(new Int16Array(ev.data as ArrayBuffer)); return }
          let msg: { type?: string; role?: string; content?: string; description?: string; functions?: { id: string; name: string; arguments?: string }[] }
          try { msg = JSON.parse(ev.data) } catch { return }
          switch (msg.type) {
            case 'Welcome': case 'SettingsApplied':
              setPhase('live'); emit({ type: 'listen' })
              // LAYER 3 — honest transition: only now flip to "Listening" + buzz the user.
              if (!vibrated) { vibrated = true; try { navigator.vibrate?.(30) } catch { /* unsupported */ }; log('tap → agent-ready', Math.round(performance.now() - tapT0), 'ms') }
              break
            case 'UserStartedSpeaking':
              tRef.current = { micFirstSent: tRef.current.micFirstSent ?? performance.now(), userStartedSpeaking: performance.now() }
              reportedRef.current = false
              agentSpeakingRef.current = false // real barge-in landed; back to normal streaming
              stopPlayback(); setPhase('thinking'); break
            case 'ConversationText':
              if (msg.role === 'user') { mk('userEndpoint'); setUserText(msg.content || ''); setPhase('thinking'); emit({ type: 'said', text: msg.content || '' }); emit({ type: 'arm' }) }
              // Stripped for display too. The prompt tells the agent not to format, but its words are
              // spoken by Deepgram before we ever see them — so if one slips through, at least the
              // owner doesn't also read the asterisks on screen.
              else if (msg.role === 'assistant') { mk('agentFirstTranscript'); const t = stripMarkdown(msg.content || ''); setAmyText(t); replyRef.current = t; emit({ type: 'reply', text: t }) }
              break
            case 'AgentStartedSpeaking': {
              agentSpeakingRef.current = true; resetGate(); setPhase('speaking')
              // ms is a CEILING — the canvas's own contract says the caller owns the handover, and
              // AgentAudioDone is what really ends it. Estimated from the text so a dropped Done event
              // cannot strand the portrait mid-word.
              const t = replyRef.current
              emit({ type: 'speak', text: t, ms: Math.min(30_000, Math.max(1_500, t.length * 55)) })
              break
            }
            case 'AgentAudioDone': agentSpeakingRef.current = false; setPhase('live'); emit({ type: 'stopSpeaking' }); emit({ type: 'listen' }); break
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
        ws.onerror = () => { if (!connectedRef.current) { setErrorMsg('Live voice is unavailable right now.'); setPhase('error') } }
        ws.onclose = () => {
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
    return () => { cancelled = true; teardown() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function enqueuePcm(int16: Int16Array) {
    const ctx = ctxRef.current
    if (!ctx || int16.length === 0) return
    // The level the host's meter renders. Peak of this packet, normalised — the packet is already here
    // and already decoded; this reads it, it does not resample or analyse anything.
    let peak = 0
    for (let i = 0; i < int16.length; i += 16) { const a = Math.abs(int16[i]); if (a > peak) peak = a }
    emit({ type: 'level', value: Math.min(1, peak / 32768) })
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
  function teardown() {
    stopPlayback()
    try { procRef.current?.disconnect() } catch { /* noop */ }
    try { wsRef.current?.close() } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    // Only close a context we own; the parent's borrowed context must stay alive so a
    // remount can keep using it (and audio playback isn't killed mid-session). close() is
    // async — swallow its rejection (e.g. "already closed") so it never bubbles up.
    if (ownsCtxRef.current && ctxRef.current && ctxRef.current.state !== 'closed') {
      try { ctxRef.current.close().catch(() => {}) } catch { /* noop */ }
    }
  }

  // Open straight into "Listening…" — no "Connecting…" flash (tap → listening → speak).
  const statusLabel = phase === 'connecting' ? 'Connecting…' : phase === 'thinking' ? 'Thinking…' : phase === 'speaking' ? 'Speaking…' : phase === 'error' ? '' : 'Listening…'
  const alive = phase === 'live' || phase === 'thinking' || phase === 'speaking'

  return (
    <div className="amy-panel mx-auto w-full max-w-md text-center" data-surface={surface}>
      <div className="relative">
        <div aria-hidden="true" className="amy-bloom pointer-events-none absolute -inset-3 rounded-[32px]" />
        <div className="amy-card relative px-6 py-6 sx-animate-in">
          <button onClick={() => { teardown(); onClose() }} className="amy-close absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center" aria-label="End">
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
