'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { WizardState } from './ai-employee-wizard'
import { VoiceSelector } from '@/components/ai-employees/voice-selector'

interface Props {
  data: WizardState
  updateData: (partial: Partial<WizardState>) => void
}

export function Step2CreateEmployee({ data, updateData }: Props) {
  const emp = data.employee

  function update(field: string, value: string | number) {
    updateData({ employee: { ...emp, [field]: value } })
  }

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

      {/* Voice picker uses the real photorealistic headshots (the persona IS the voice). */}
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
