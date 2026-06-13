'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { WizardState } from './ai-employee-wizard'
import { cn } from '@/lib/utils'
import { VoiceSelector } from '@/components/ai-employees/voice-selector'

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
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
        <VoiceSelector value={emp.voice} onChange={(v) => update('voice', v)} />
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
