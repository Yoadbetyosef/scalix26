'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Play, Square } from 'lucide-react'

export const VOICES = [
  { id: 'aura-2-asteria-en', name: 'Asteria', gender: 'Female', description: 'Warm & friendly' },
  { id: 'aura-2-andromeda-en', name: 'Andromeda', gender: 'Female', description: 'Professional & clear' },
  { id: 'aura-2-thalia-en', name: 'Thalia', gender: 'Female', description: 'Energetic & bright' },
  { id: 'aura-2-odysseus-en', name: 'Odysseus', gender: 'Male', description: 'Deep & professional' },
  { id: 'aura-2-arcas-en', name: 'Arcas', gender: 'Male', description: 'Natural & smooth' },
]

// Real photorealistic headshot per voice, e.g. /avatars/asteria.png.
const headshot = (name: string) => `/avatars/${name.toLowerCase()}.png`

const PREVIEW_TEXT = 'Hi! Thanks for calling. How can I help you today?'

function WaveBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-1 h-5" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-1 rounded-full ${active ? 'voice-bar bg-[#4ecdc4]' : 'bg-gray-200'} h-5`}
          style={active ? { animationDelay: `${i * 0.12}s` } : undefined}
        />
      ))}
    </div>
  )
}

export function VoiceSelector({ value, onChange }: { value: string; onChange: (voiceId: string) => void }) {
  const active = VOICES.some((v) => v.id === value) ? value : VOICES[0].id
  const selected = VOICES.find((v) => v.id === active)!

  const [speaking, setSpeaking] = useState(false)
  const [status, setStatus] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const busy = speaking

  // If the saved voice isn't one of the real options (legacy value), default it
  // so a Save persists a valid voice.
  useEffect(() => {
    if (!VOICES.some((v) => v.id === value)) onChange(VOICES[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function play(text: string) {
    const res = await fetch(`/api/tts?voice=${encodeURIComponent(active)}&text=${encodeURIComponent(text)}`)
    if (!res.ok) throw new Error('tts')
    const url = URL.createObjectURL(await res.blob())
    const audio = new Audio(url)
    audioRef.current = audio
    await new Promise<void>((resolve) => {
      audio.onended = () => { URL.revokeObjectURL(url); resolve() }
      audio.onerror = () => { URL.revokeObjectURL(url); resolve() }
      audio.play().catch(() => resolve())
    })
  }

  async function preview() {
    if (busy) return
    setSpeaking(true)
    setStatus('Speaking…')
    try { await play(PREVIEW_TEXT) } catch { toast.error('Preview unavailable') }
    finally { setSpeaking(false); setStatus('') }
  }

  // Stop an in-progress preview playback.
  function stopPreview() {
    try { audioRef.current?.pause() } catch { /* noop */ }
    setSpeaking(false); setStatus('')
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-gray-700">Choose your AI voice</p>

      {/* Voice picker grid — real headshots */}
      <div className="flex flex-wrap gap-3">
        {VOICES.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onChange(v.id)}
            className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-colors ${
              active === v.id ? 'border-[#4ecdc4] bg-[#4ecdc4]/10' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={headshot(v.name)} alt={v.name} className="w-14 h-14 rounded-full object-cover" />
            <span className="text-xs font-medium text-gray-700">{v.name}</span>
          </button>
        ))}
      </div>

      {/* Selected voice — demo card */}
      <div className="rounded-xl border-2 border-[#4ecdc4] bg-[#4ecdc4]/5 p-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={headshot(selected.name)} alt={selected.name} className="w-12 h-12 rounded-full object-cover" />
          <div>
            <p className="font-semibold text-gray-900">{selected.name}</p>
            <p className="text-xs text-gray-500">{selected.description} • {selected.gender}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            type="button"
            onClick={preview}
            disabled={busy}
            className="tap-target inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Play className="w-4 h-4" /> Preview
          </button>

          {speaking && (
            <button
              type="button"
              onClick={stopPreview}
              className="tap-target inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600"
            >
              <Square className="w-4 h-4" /> Stop
            </button>
          )}

          {speaking && <WaveBars active />}
          {status && <span className="text-xs text-gray-500 ml-1">{status}</span>}
        </div>

        <p className="text-xs text-gray-400 mt-3">
          Preview plays a sample of the selected voice.
        </p>
      </div>
    </div>
  )
}
