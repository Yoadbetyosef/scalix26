'use client'

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
  { id: 'professional_female', label: 'Professional Female' },
  { id: 'professional_male', label: 'Professional Male' },
  { id: 'friendly_female', label: 'Friendly Female' },
  { id: 'friendly_male', label: 'Friendly Male' },
]

export function Step2CreateEmployee({ data, updateData }: Props) {
  const emp = data.employee

  function update(field: string, value: string | number) {
    updateData({ employee: { ...emp, [field]: value } })
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
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          {VOICES.map(voice => (
            <button
              key={voice.id}
              type="button"
              onClick={() => update('voice', voice.id)}
              className={cn(
                'px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all text-left',
                emp.voice === voice.id
                  ? 'border-[#4ecdc4] bg-[#4ecdc4]/5 text-[#3db8af]'
                  : 'border-gray-100 hover:border-gray-300 text-gray-700'
              )}
            >
              {voice.label}
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
