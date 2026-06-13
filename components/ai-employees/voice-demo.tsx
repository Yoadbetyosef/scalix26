'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Mic, Square, Play } from 'lucide-react'

export const VOICES = [
  { id: 'aura-2-asteria-en', name: 'Asteria', gender: 'Female', description: 'Warm & friendly' },
  { id: 'aura-2-andromeda-en', name: 'Andromeda', gender: 'Female', description: 'Professional & clear' },
  { id: 'aura-2-thalia-en', name: 'Thalia', gender: 'Female', description: 'Energetic & bright' },
  { id: 'aura-2-odysseus-en', name: 'Odysseus', gender: 'Male', description: 'Deep & professional' },
  { id: 'aura-2-arcas-en', name: 'Arcas', gender: 'Male', description: 'Natural & smooth' },
]

const avatarUrl = (name: string) => `/avatars/${name.toLowerCase()}.png`
const PREVIEW_TEXT = 'Hi! Thanks for calling. How can I help you today?'

type Mode = 'idle' | 'listening' | 'thinking' | 'speaking'
type Turn = { role: 'agent' | 'user'; text: string }

// Minimal Web Speech API typing (not in TS DOM lib).
interface SpeechResultList { length: number;[i: number]: { isFinal: boolean; 0: { transcript: string } } }
interface SpeechRec {
  lang: string; interimResults: boolean; continuous: boolean
  start: () => void; stop: () => void; abort: () => void
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

function getSpeechRec(): (new () => SpeechRec) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

// SVG wave — 4 rounded bars whose height follows the live audio level.
function WaveViz({ level, mode }: { level: number; mode: Mode }) {
  const active = mode === 'listening' || mode === 'speaking'
  const base = 8
  const range = mode === 'speaking' ? 30 : mode === 'listening' ? 16 : 0
  const factors = [0.55, 1, 0.75, 0.45]
  return (
    <svg viewBox="0 0 120 56" className="w-40 h-14" aria-hidden>
      <defs>
        <linearGradient id="vd-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ecdc4" />
          <stop offset="100%" stopColor="#3db8af" />
        </linearGradient>
      </defs>
      {factors.map((f, i) => {
        const h = active ? base + level * range * f * 2 : base
        const x = 24 + i * 24
        return (
          <rect
            key={i}
            x={x}
            y={28 - h / 2}
            width="10"
            height={Math.max(6, h)}
            rx="5"
            fill="url(#vd-grad)"
            className="transition-[height,y] duration-75 ease-out"
          />
        )
      })}
    </svg>
  )
}

export function VoiceDemo({ value, onChange, systemPrompt }: { value: string; onChange: (voiceId: string) => void; systemPrompt?: string }) {
  const active = VOICES.some((v) => v.id === value) ? value : VOICES[0].id
  const selected = VOICES.find((v) => v.id === active)!
  const supported = !!getSpeechRec()

  const [mode, setMode] = useState<Mode>('idle')
  const [level, setLevel] = useState(0)
  const [turns, setTurns] = useState<Turn[]>([])
  const [interim, setInterim] = useState('')

  const activeRef = useRef(false)        // conversation running
  const voiceRef = useRef(active)        // latest selected voice for async callbacks
  const promptRef = useRef(systemPrompt)
  const recRef = useRef<SpeechRec | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const micSrcRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  voiceRef.current = active
  promptRef.current = systemPrompt

  // If saved voice is a legacy value, default to a real one so Save persists it.
  useEffect(() => {
    if (!VOICES.some((v) => v.id === value)) onChange(VOICES[0].id)
    return () => endConversation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-scroll the transcript.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, interim])

  function ensureCtx() {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctor()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctxRef.current = ctx
      analyserRef.current = analyser
    }
    return { ctx: ctxRef.current, analyser: analyserRef.current! }
  }

  function startWaveLoop() {
    const analyser = analyserRef.current
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      setLevel(Math.min(1, sum / data.length / 140))
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }
  function stopWaveLoop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    setLevel(0)
  }

  async function chat(message: string): Promise<string> {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, system_prompt: promptRef.current || undefined }),
    })
    const data = await res.json().catch(() => ({}))
    return typeof data.reply === 'string' ? data.reply : ''
  }

  async function speak(text: string) {
    const res = await fetch(`/api/tts?voice=${encodeURIComponent(voiceRef.current)}&text=${encodeURIComponent(text)}`)
    if (!res.ok) throw new Error('tts')
    const url = URL.createObjectURL(await res.blob())
    const audio = new Audio(url)
    let srcNode: MediaElementAudioSourceNode | null = null
    try {
      const { ctx, analyser } = ensureCtx()
      await ctx.resume()
      // While the agent speaks, route audio → analyser → speakers (and keep mic off the analyser).
      try { micSrcRef.current?.disconnect() } catch { /* noop */ }
      srcNode = ctx.createMediaElementSource(audio)
      srcNode.connect(analyser)
      analyser.connect(ctx.destination)
    } catch { /* analysis unavailable — still play below */ }

    await new Promise<void>((resolve) => {
      audio.onended = () => resolve()
      audio.onerror = () => resolve()
      audio.play().catch(() => resolve())
    })
    try { srcNode?.disconnect() } catch { /* noop */ }
    try { analyserRef.current?.disconnect() } catch { /* noop */ }
    URL.revokeObjectURL(url)
  }

  function startRecognition() {
    const Ctor = getSpeechRec()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let interimText = ''
      let finalText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += t
        else interimText += t
      }
      setInterim(interimText)
      if (finalText.trim()) handleUtterance(finalText.trim())
    }
    rec.onerror = () => { /* ignore transient errors */ }
    rec.onend = () => {
      // Auto-restart while still listening (recognition stops itself periodically).
      if (activeRef.current && mode !== 'speaking') {
        try { rec.start() } catch { /* already started */ }
      }
    }
    recRef.current = rec
    try { rec.start() } catch { /* noop */ }
  }

  function stopRecognition() {
    const rec = recRef.current
    recRef.current = null
    if (rec) { try { rec.onend = null; rec.abort() } catch { /* noop */ } }
  }

  async function handleUtterance(text: string) {
    if (!activeRef.current || mode === 'thinking' || mode === 'speaking') return
    stopRecognition()
    setInterim('')
    setTurns((t) => [...t, { role: 'user', text }])
    setMode('thinking')
    try {
      const reply = await chat(text)
      if (!activeRef.current) return
      if (reply) {
        setTurns((t) => [...t, { role: 'agent', text: reply }])
        setMode('speaking')
        await speak(reply)
      }
    } catch {
      toast.error('Something went wrong')
    } finally {
      if (activeRef.current) resumeListening()
    }
  }

  async function resumeListening() {
    setMode('listening')
    // Reconnect mic to the analyser for listening waves.
    try {
      const { ctx, analyser } = ensureCtx()
      if (micSrcRef.current) micSrcRef.current.connect(analyser)
      await ctx.resume()
    } catch { /* noop */ }
    startRecognition()
  }

  async function startConversation() {
    if (!supported) return
    activeRef.current = true
    setTurns([])
    setInterim('')
    try {
      const { ctx, analyser } = ensureCtx()
      await ctx.resume()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      const micSrc = ctx.createMediaStreamSource(stream)
      micSrc.connect(analyser)
      micSrcRef.current = micSrc
    } catch {
      toast.error('Microphone access is required for the demo')
      activeRef.current = false
      return
    }
    startWaveLoop()
    setMode('listening')
    startRecognition()
  }

  function endConversation() {
    activeRef.current = false
    stopRecognition()
    stopWaveLoop()
    try { micSrcRef.current?.disconnect() } catch { /* noop */ }
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* noop */ }
    micSrcRef.current = null
    micStreamRef.current = null
    setInterim('')
    setMode('idle')
  }

  async function preview(voiceId: string) {
    try {
      const res = await fetch(`/api/tts?voice=${encodeURIComponent(voiceId)}&text=${encodeURIComponent(PREVIEW_TEXT)}`)
      if (!res.ok) throw new Error()
      const url = URL.createObjectURL(await res.blob())
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch { toast.error('Preview unavailable') }
  }

  const statusText = mode === 'listening' ? 'Listening…' : mode === 'thinking' ? 'Thinking…' : mode === 'speaking' ? 'Speaking…' : ''

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-gray-700">Choose your AI voice</p>

      {/* Voice picker */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {VOICES.map((v) => {
          const isSel = active === v.id
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onChange(v.id)}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-colors ${
                isSel ? 'border-[#4ecdc4] bg-[#4ecdc4]/10' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarUrl(v.name)} alt={v.name} className="w-12 h-12 rounded-full object-cover bg-white border border-gray-100" />
              <span className="text-sm font-semibold text-gray-900">{v.name}</span>
              <span className="text-[11px] text-gray-400 leading-tight text-center">{v.gender}</span>
            </button>
          )
        })}
      </div>

      {/* Demo stage */}
      <div className="rounded-xl border-2 border-[#4ecdc4] bg-[#4ecdc4]/5 p-5">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl(selected.name)} alt={selected.name} className="w-12 h-12 rounded-full object-cover bg-white border border-gray-100" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900">{selected.name}</p>
            <p className="text-xs text-gray-500">{selected.description} • {selected.gender}</p>
          </div>
          <WaveViz level={level} mode={mode} />
        </div>

        <div className="flex items-center gap-2 mt-4">
          {!supported ? (
            <button
              type="button"
              onClick={() => preview(active)}
              className="tap-target inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-[#4ecdc4] text-white hover:bg-[#3db8af]"
            >
              <Play className="w-4 h-4" /> Preview voice
            </button>
          ) : mode === 'idle' ? (
            <>
              <button
                type="button"
                onClick={startConversation}
                className="tap-target inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[#4ecdc4] text-white hover:bg-[#3db8af]"
              >
                <Mic className="w-4 h-4" /> Talk To Your Agent
              </button>
              <button
                type="button"
                onClick={() => preview(active)}
                className="tap-target inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                <Play className="w-4 h-4" /> Preview
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={endConversation}
              className="tap-target inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600"
            >
              <Square className="w-4 h-4" /> End Conversation
            </button>
          )}
          {statusText && <span className="text-xs text-gray-500 ml-1">{statusText}</span>}
        </div>

        {!supported && (
          <p className="text-xs text-amber-600 mt-3">Voice demo requires Chrome or Safari. You can still preview each voice.</p>
        )}

        {/* Transcript */}
        {(turns.length > 0 || interim) && (
          <div ref={scrollRef} className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 max-h-[300px] overflow-y-auto">
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
                    t.role === 'user'
                      ? 'bg-teal-50 border border-[#4ecdc4]/40 text-gray-800'
                      : 'bg-white border border-gray-200 text-gray-800'
                  }`}
                >
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">
                    {t.role === 'user' ? 'You' : selected.name}
                  </span>
                  {t.text}
                </div>
              </div>
            ))}
            {interim && (
              <div className="flex justify-end">
                <div className="max-w-[80%] px-3 py-2 rounded-xl text-sm bg-teal-50/60 border border-[#4ecdc4]/20 text-gray-400 italic">
                  {interim}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
