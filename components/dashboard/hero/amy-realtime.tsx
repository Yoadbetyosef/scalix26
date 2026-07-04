'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { EmployeeAvatar } from '@/components/ai-employees/employee-avatar'
import { X } from 'lucide-react'
import { type AmyBriefing, TTS_VOICE, buildRealtimePrompt } from './ask-amy-shared'

const PROXY_URL = process.env.NEXT_PUBLIC_AMY_REALTIME_URL || 'ws://localhost:8081'
const DEBUG = process.env.NODE_ENV !== 'production'
/* eslint-disable no-console */
const log = (...a: unknown[]) => { if (DEBUG) console.log('%c[amy-realtime]', 'color:#5B6CF0', ...a) }
/* eslint-enable no-console */

type Phase = 'connecting' | 'live' | 'thinking' | 'speaking' | 'error'

export function AmyRealtime({ briefing, audioCtx, onClose, onType }: { briefing: AmyBriefing; audioCtx?: AudioContext | null; onClose: () => void; onType: () => void }) {
  const name = briefing.employeeName || 'Amy'
  const [phase, setPhase] = useState<Phase>('connecting')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [userText, setUserText] = useState('')
  const [amyText, setAmyText] = useState('')

  const wsRef = useRef<WebSocket | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const ownsCtxRef = useRef(false) // true only if WE created the context (vs. borrowed from parent)
  const streamRef = useRef<MediaStream | null>(null)
  const procRef = useRef<ScriptProcessorNode | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const playHeadRef = useRef(0)
  const connectedRef = useRef(false)

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
        // Prefer the AudioContext already unlocked inside the user's tap (mobile autoplay
        // policy); only create one here as a fallback (e.g. desktop deep-links). We close
        // it on teardown ONLY if we created it — never the parent's borrowed context.
        let ctx = audioCtx
        if (!ctx || ctx.state === 'closed') {
          ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
          ownsCtxRef.current = true
        }
        ctxRef.current = ctx
        // Best-effort resume; it's already unlocked in the tap, so never block mic/WS
        // setup on it (a hung resume must not stall the whole conversation).
        ctx.resume().catch(() => {})
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream

        // Ground the voice agent in THIS business's real data — fetched in PARALLEL with the
        // socket connect so it never delays listening.
        const snapshotPromise = (async () => {
          try { const r = await fetch('/api/ai/amy/snapshot'); if (r.ok) return ((await r.json()).snapshot || '') as string } catch { /* fine without it */ }
          return ''
        })()

        const ws = new WebSocket(PROXY_URL)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws
        const t0 = performance.now()

        ws.onopen = async () => {
          connectedRef.current = true
          log('proxy open', Math.round(performance.now() - t0), 'ms — REALTIME PATH active')
          const snapshot = await snapshotPromise
          if (cancelled || ws.readyState !== WebSocket.OPEN) return
          ws.send(JSON.stringify({
            type: 'config',
            voice: TTS_VOICE(briefing.employeeVoice),
            prompt: buildRealtimePrompt(briefing) + (snapshot ? `\n\nCURRENT BUSINESS DATA (real, this business only — answer from it, never say you lack access):\n${snapshot}` : ''),
            // No spoken greeting — open straight into Listening so the user can talk immediately.
            greeting: '',
            inputSampleRate: ctx.sampleRate,
            eot: 0.7,
          }))
          const source = ctx.createMediaStreamSource(stream)
          const proc = ctx.createScriptProcessor(2048, 1, 1)
          procRef.current = proc
          proc.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return
            const f32 = e.inputBuffer.getChannelData(0)
            const i16 = new Int16Array(f32.length)
            for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff }
            ws.send(i16.buffer)
            if (tRef.current.micFirstSent === undefined) { mk('micFirstSent'); log('mic streaming → agent') }
          }
          const mute = ctx.createGain(); mute.gain.value = 0
          source.connect(proc); proc.connect(mute); mute.connect(ctx.destination)
        }

        ws.onmessage = (ev) => {
          if (typeof ev.data !== 'string') { mk('firstAudioPacket'); enqueuePcm(new Int16Array(ev.data as ArrayBuffer)); return }
          let msg: { type?: string; role?: string; content?: string; description?: string }
          try { msg = JSON.parse(ev.data) } catch { return }
          switch (msg.type) {
            case 'Welcome': case 'SettingsApplied': setPhase('live'); break
            case 'UserStartedSpeaking':
              tRef.current = { micFirstSent: tRef.current.micFirstSent ?? performance.now(), userStartedSpeaking: performance.now() }
              reportedRef.current = false
              stopPlayback(); setPhase('thinking'); break
            case 'ConversationText':
              if (msg.role === 'user') { mk('userEndpoint'); setUserText(msg.content || ''); setPhase('thinking') }
              else if (msg.role === 'assistant') { mk('agentFirstTranscript'); setAmyText(msg.content || '') }
              break
            case 'AgentStartedSpeaking': setPhase('speaking'); break
            case 'AgentAudioDone': setPhase('live'); break
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
  const statusLabel = phase === 'thinking' ? 'Thinking…' : phase === 'speaking' ? 'Speaking…' : phase === 'error' ? '' : 'Listening…'
  const alive = phase === 'live' || phase === 'thinking' || phase === 'speaking'

  return (
    <div className="mx-auto w-full max-w-md text-center">
      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute -inset-3 rounded-[32px] bg-accent/10 blur-2xl opacity-70" />
        <div className="relative rounded-3xl bg-white ring-1 ring-hairline shadow-e3 px-6 py-6 sx-animate-in">
          <button onClick={() => { teardown(); onClose() }} className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-muted hover:text-ink transition-colors" aria-label="End">
            <X className="h-4 w-4" />
          </button>

          {/* Amy's living presence — the voice ring reflects her state */}
          <div className="flex flex-col items-center">
            <div className="relative inline-flex">
              {phase === 'speaking' && <span aria-hidden="true" className="pointer-events-none absolute -inset-2 rounded-full sx-ring-live" />}
              {(phase === 'live' || phase === 'thinking') && <span aria-hidden="true" className="pointer-events-none absolute -inset-2 rounded-full ring-2 ring-accent/40 animate-ping" />}
              <EmployeeAvatar name={name} voice={briefing.employeeVoice} status={phase === 'error' ? 'paused' : 'on_duty'} size="lg" showStatus={false} className={cn(alive && 'sx-breathe')} />
            </div>

            {phase === 'error' ? (
              <>
                <p className="mt-5 text-sm text-muted">{errorMsg}</p>
                <button onClick={onType} className="mt-3 text-xs font-medium text-accent-strong hover:underline">Type instead</button>
              </>
            ) : (
              <>
                <p className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-ink">
                  {phase === 'speaking' && (
                    <span className="flex items-end gap-[2px] h-3" aria-hidden="true">
                      {[0, 1, 2, 3].map((i) => <span key={i} className="sx-wavebar w-[2px] h-full rounded-full bg-accent" style={{ animationDelay: `${i * 0.12}s` }} />)}
                    </span>
                  )}
                  {statusLabel}
                </p>
                {(userText || amyText) && (
                  <div className="mt-3">
                    {userText && <p className="text-xs text-muted">“{userText}”</p>}
                    {amyText && <p className="mt-1 text-[15px] font-light leading-relaxed text-ink">{amyText}</p>}
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
