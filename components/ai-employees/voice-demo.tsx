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
    <div>
      {/* THE VOICE PICKER KEEPS ITS PORTRAITS, and that is not a breach of the one-face rule. The
          employee's face is the robot; this is the question "whose voice should it speak in", and a
          voice belongs to a person. The employee's own avatar is fifty pixels up the page in its
          robot form, so the two never claim to be the same thing. */}
      <div className="flex flex-wrap gap-2" style={{ marginBottom: 18 }}>
        {VOICES.map((v) => {
          const isSel = active === v.id
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onChange(v.id)}
              aria-pressed={isSel}
              className="v2-vopt"
              data-on={isSel || undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarUrl(v.name)} alt="" />
              <b>{v.name}</b>
              <em>{v.gender}</em>
            </button>
          )
        })}
      </div>

      {/* The one selected, and the button that plays it. */}
      <div className="v2-grow" data-static style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarUrl(selected.name)} alt="" style={{ width: 40, height: 40, flex: 'none', borderRadius: '50%', objectFit: 'cover', background: '#fff', border: '1px solid var(--v2-line)' }} />
        <span className="v2-glab">
          <b style={{ fontWeight: 550 }}>{selected.name}</b>
          <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--v2-ink-45)' }}>{selected.description} · {selected.gender}</span>
        </span>
        <span className="v2-gtrail">
          <WaveViz level={0} mode="idle" />
          <button type="button" onClick={() => preview(active)} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
            <Play className="w-3.5 h-3.5" /> Preview
          </button>
        </span>
      </div>
    </div>
  )
}
