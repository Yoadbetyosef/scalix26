'use client'

import { useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { WizardState } from './ai-employee-wizard'
import { cn } from '@/lib/utils'

interface Props {
  data: WizardState
  updateData: (partial: Partial<WizardState>) => void
}

const AVATARS = [
  { id: 'avatar-1', label: 'Professional Female', emoji: '👩‍💼' },
  { id: 'avatar-2', label: 'Professional Male', emoji: '👨‍💼' },
  { id: 'avatar-3', label: 'Friendly Female', emoji: '👩' },
  { id: 'avatar-4', label: 'Friendly Male', emoji: '👨' },
  { id: 'avatar-5', label: 'Tech Female', emoji: '👩‍💻' },
  { id: 'avatar-6', label: 'Tech Male', emoji: '👨‍💻' },
  { id: 'avatar-7', label: 'Expert Female', emoji: '👩‍🔧' },
  { id: 'avatar-8', label: 'Expert Male', emoji: '👨‍🔧' },
]

const VOICES = [
  {
    id: 'professional_female',
    label: 'Professional Female',
    sample: "Hi, thank you for calling. I'm here to help you schedule a service appointment.",
    lang: 'en-US',
    gender: 'female',
    pitch: 1.1,
    rate: 0.95,
  },
  {
    id: 'professional_male',
    label: 'Professional Male',
    sample: "Hello, thanks for reaching out. How can I assist you with your service needs today?",
    lang: 'en-US',
    gender: 'male',
    pitch: 0.85,
    rate: 0.95,
  },
  {
    id: 'friendly_female',
    label: 'Friendly Female',
    sample: "Hey there! So glad you called! We'd love to help you out today — what can we do for you?",
    lang: 'en-US',
    gender: 'female',
    pitch: 1.2,
    rate: 1.05,
  },
  {
    id: 'friendly_male',
    label: 'Friendly Male',
    sample: "Hey! Thanks for calling! What can I help you with today? We've got you covered!",
    lang: 'en-US',
    gender: 'male',
    pitch: 0.9,
    rate: 1.05,
  },
]

function playBrowserVoice(voice: typeof VOICES[0], onEnd: () => void) {
  const utter = new SpeechSynthesisUtterance(voice.sample)
  utter.lang = voice.lang
  utter.pitch = voice.pitch
  utter.rate = voice.rate
  utter.onend = onEnd
  utter.onerror = onEnd

  const trySpeak = () => {
    const voices = window.speechSynthesis.getVoices()
    const enVoices = voices.filter(v => v.lang.startsWith('en'))
    const gendered = enVoices.filter(v => {
      const n = v.name.toLowerCase()
      return voice.gender === 'female'
        ? n.includes('female') || n.includes('samantha') || n.includes('victoria') || n.includes('karen') || n.includes('ava') || n.includes('zira')
        : n.includes('daniel') || n.includes('alex') || n.includes('david') || n.includes('mark') || n.includes('tom') || n.includes('fred')
    })
    if (gendered[0]) utter.voice = gendered[0]
    else if (enVoices[0]) utter.voice = enVoices[0]
    window.speechSynthesis.speak(utter)
  }

  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = trySpeak
  } else {
    trySpeak()
  }
}

export function Step2CreateEmployee({ data, updateData }: Props) {
  const emp = data.employee
  const [playingId, setPlayingId] = useState<string | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  function update(field: string, value: string | number) {
    updateData({ employee: { ...emp, [field]: value } })
  }

  async function playVoice(voice: typeof VOICES[0], e: React.MouseEvent) {
    e.stopPropagation()

    // Stop current playback
    window.speechSynthesis.cancel()
    if (utteranceRef.current) {
      utteranceRef.current = null
    }
    if (playingId === voice.id) {
      setPlayingId(null)
      return
    }

    setPlayingId(voice.id)

    // Try ElevenLabs first (human-quality), fall back to browser TTS
    try {
      const res = await fetch('/api/ai/preview-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: voice.id }),
      })

      if (!res.ok) throw new Error('ElevenLabs not available')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => { setPlayingId(null); URL.revokeObjectURL(url) }
      audio.onerror = () => { setPlayingId(null); URL.revokeObjectURL(url) }
      await audio.play()
    } catch {
      // Fallback: browser TTS
      playBrowserVoice(voice, () => setPlayingId(null))
    }
  }

  const selectedAvatar = AVATARS.find(a => `/avatars/${a.id}.png` === emp.avatar_url) || AVATARS[0]

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Create Your AI Employee</h2>
        <p className="text-sm text-gray-500">Customize how your AI employee looks, sounds, and communicates.</p>
      </div>

      <div>
        <Label>Name</Label>
        <Input
          className="mt-1.5"
          placeholder="Alex"
          value={emp.name}
          onChange={e => update('name', e.target.value)}
        />
      </div>

      <div>
        <Label>Avatar</Label>
        <div className="grid grid-cols-4 gap-2 mt-1.5">
          {AVATARS.map(avatar => (
            <button
              key={avatar.id}
              type="button"
              onClick={() => update('avatar_url', `/avatars/${avatar.id}.png`)}
              className={cn(
                'flex flex-col items-center p-3 rounded-xl border-2 transition-all',
                selectedAvatar.id === avatar.id
                  ? 'border-[#4ecdc4] bg-[#4ecdc4]/5'
                  : 'border-gray-100 hover:border-gray-300'
              )}
            >
              <span className="text-3xl">{avatar.emoji}</span>
              <span className="text-xs text-gray-500 mt-1 text-center leading-tight">{avatar.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>Voice</Label>
        <p className="text-xs text-gray-400 mb-2 mt-0.5">Click ▶ to preview each voice</p>
        <div className="grid grid-cols-2 gap-2">
          {VOICES.map(voice => (
            <button
              key={voice.id}
              type="button"
              onClick={() => update('voice', voice.id)}
              className={cn(
                'flex items-center justify-between px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all text-left gap-2',
                emp.voice === voice.id
                  ? 'border-[#4ecdc4] bg-[#4ecdc4]/5 text-[#3db8af]'
                  : 'border-gray-100 hover:border-gray-300 text-gray-700'
              )}
            >
              <span className="flex-1">{voice.label}</span>
              <span
                role="button"
                onClick={(e) => playVoice(voice, e)}
                className={cn(
                  'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors',
                  playingId === voice.id
                    ? 'bg-[#4ecdc4] text-white'
                    : 'bg-gray-100 hover:bg-[#4ecdc4]/20 text-gray-500 hover:text-[#4ecdc4]'
                )}
              >
                {playingId === voice.id
                  ? <Square className="w-3 h-3 fill-current" />
                  : <Play className="w-3 h-3 fill-current ml-0.5" />
                }
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>Personality</Label>
        <div className="mt-2">
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>Formal</span>
            <span>Friendly</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={emp.personality_score}
            onChange={e => update('personality_score', parseInt(e.target.value))}
            className="w-full accent-[#4ecdc4]"
          />
          <p className="text-xs text-gray-500 mt-1 text-center">
            {emp.personality_score < 33 ? 'Very formal & professional' :
             emp.personality_score < 66 ? 'Balanced tone' : 'Warm & friendly'}
          </p>
        </div>
      </div>

      <div>
        <Label>Greeting Message</Label>
        <Textarea
          className="mt-1.5"
          rows={3}
          placeholder="Hi! Thank you for contacting us..."
          value={emp.greeting}
          onChange={e => update('greeting', e.target.value)}
        />
        <p className="text-xs text-gray-400 mt-1">This is the first message customers receive.</p>
      </div>
    </div>
  )
}
