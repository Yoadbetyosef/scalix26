'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { Play } from 'lucide-react'

// The catalogue is in lib/voices — three copies of these five rows had already accumulated, and the
// TTS routes were reading a fourth, different vocabulary entirely. Re-exported so existing importers
// of `VOICES` keep working.
import { AURA_VOICES as VOICES } from '@/lib/voices'
export { VOICES }

import { voiceHeadshot as avatarUrl } from '@/lib/voices'
const PREVIEW_TEXT = 'Hi! Thanks for calling. How can I help you today?'

type Mode = 'idle' | 'listening' | 'thinking' | 'speaking'

// Reactive "voice bubble" — a colorful orb that pulses with the live audio
// level and emits expanding rings when there's sound; breathes gently when idle.
function WaveViz({ level, mode }: { level: number; mode: Mode }) {
  const active = mode === 'listening' || mode === 'speaking'
  const l = active ? Math.min(1, level) : 0
  const gain = mode === 'speaking' ? 1 : 0.7
  const core = 11 + l * 13 * gain
  const ring1 = 16 + l * 16 * gain
  const ring2 = 20 + l * 24 * gain
  return (
    <svg viewBox="0 0 64 64" className={`w-16 h-16 ${mode === 'idle' ? 'animate-orb-idle' : ''}`} aria-hidden>
      <defs>
        <radialGradient id="vd-orb" cx="42%" cy="38%" r="65%">
          <stop offset="0%" stopColor="#a7f3eb" />
          <stop offset="40%" stopColor="#5B6CF0" />
          <stop offset="75%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#818cf8" />
        </radialGradient>
        <filter id="vd-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
      </defs>
      {/* expanding ripple rings while there's sound */}
      {active && (
        <>
          <circle cx="32" cy="32" r={ring2} fill="none" stroke="#38bdf8" strokeWidth="2"
            strokeOpacity={0.12 + l * 0.22} className="transition-all duration-75 ease-out" />
          <circle cx="32" cy="32" r={ring1} fill="none" stroke="#5B6CF0" strokeWidth="2.5"
            strokeOpacity={0.22 + l * 0.35} className="transition-all duration-75 ease-out" />
        </>
      )}
      {/* core orb */}
      <circle cx="32" cy="32" r={core} fill="url(#vd-orb)" filter="url(#vd-soft)"
        className="transition-[r] duration-75 ease-out" />
      {/* soft highlight */}
      <circle cx={32 - core * 0.28} cy={32 - core * 0.32} r={core * 0.28} fill="#ffffff" fillOpacity="0.45" />
    </svg>
  )
}

export function VoiceDemo({ value, onChange }: { value: string; onChange: (voiceId: string) => void }) {
  const active = VOICES.some((v) => v.id === value) ? value : VOICES[0].id
  const selected = VOICES.find((v) => v.id === active)!

  // If saved voice is a legacy value, default to a real one so Save persists it.
  useEffect(() => {
    if (!VOICES.some((v) => v.id === value)) onChange(VOICES[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Play a short TTS sample of the selected voice. Fast, fire-and-forget.
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

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-ink">Choose your AI voice</p>

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
                isSel ? 'border-[#5B6CF0] bg-[#5B6CF0]/10' : 'border-hairline-strong hover:border-hairline-strong'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarUrl(v.name)} alt={v.name} className="w-12 h-12 rounded-full object-cover bg-white border border-hairline" />
              <span className="text-sm font-semibold text-ink">{v.name}</span>
              <span className="text-[11px] text-muted leading-tight text-center">{v.gender}</span>
            </button>
          )
        })}
      </div>

      {/* Demo stage */}
      <div className="rounded-xl border-2 border-[#5B6CF0] bg-[#5B6CF0]/5 p-5">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUrl(selected.name)} alt={selected.name} className="w-12 h-12 rounded-full object-cover bg-white border border-hairline" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink">{selected.name}</p>
            <p className="text-xs text-subtle">{selected.description} • {selected.gender}</p>
          </div>
          <WaveViz level={0} mode="idle" />
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            type="button"
            onClick={() => preview(active)}
            className="tap-target inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-ink text-white hover:bg-ink/90"
          >
            <Play className="w-4 h-4" /> Preview
          </button>
        </div>
      </div>
    </div>
  )
}
