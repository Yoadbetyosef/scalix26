'use client'

import { Switch } from '@/components/ui/switch'
import { WizardState } from './ai-employee-wizard'
import { ChannelType } from '@/types'
import { Phone, MessageSquare, Globe } from 'lucide-react'

interface Props {
  data: WizardState
  updateData: (partial: Partial<WizardState>) => void
}

const CHANNELS: Array<{
  type: ChannelType
  name: string
  description: string
  icon: React.ElementType
  color: string
  note?: string
}> = [
  {
    type: 'voice',
    name: 'Voice (Phone)',
    description: 'Answer phone calls automatically with your AI employee.',
    icon: Phone,
    color: 'bg-purple-50 text-purple-600',
    note: 'Twilio phone number will be provisioned',
  },
  {
    type: 'sms',
    name: 'SMS',
    description: 'Handle text messages on the same phone number.',
    icon: MessageSquare,
    color: 'bg-blue-50 text-blue-600',
    note: 'Uses the same Twilio number as Voice',
  },
  {
    type: 'instagram',
    name: 'Instagram DM',
    description: 'Auto-reply to Instagram Direct Messages.',
    icon: Globe,
    color: 'bg-pink-50 text-pink-600',
    note: 'Requires Instagram Business account',
  },
  {
    type: 'facebook',
    name: 'Facebook Messenger',
    description: 'Handle Facebook Page messages automatically.',
    icon: Globe,
    color: 'bg-indigo-50 text-indigo-600',
    note: 'Requires Facebook Page',
  },
]

export function Step5Channels({ data, updateData }: Props) {
  function toggle(type: ChannelType) {
    const current = data.activeChannels
    const updated = current.includes(type)
      ? current.filter(c => c !== type)
      : [...current, type]
    updateData({ activeChannels: updated })
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Communication Channels</h2>
        <p className="text-sm text-gray-500">Choose how customers can reach your AI employee. Connect channels after setup.</p>
      </div>

      <div className="space-y-3">
        {CHANNELS.map(channel => {
          const Icon = channel.icon
          const active = data.activeChannels.includes(channel.type)
          return (
            <div
              key={channel.type}
              className="flex items-start gap-4 p-4 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? channel.color : 'bg-gray-100 text-gray-400'}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{channel.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{channel.description}</p>
                {channel.note && active && (
                  <p className="text-xs text-[#4ecdc4] mt-1">{channel.note}</p>
                )}
              </div>
              <Switch
                checked={active}
                onCheckedChange={() => toggle(channel.type)}
                className="flex-shrink-0 mt-0.5"
              />
            </div>
          )
        })}
      </div>

      <div className="bg-[#1a1f36]/5 rounded-xl p-4 text-sm text-gray-600">
        <p className="font-medium mb-1">What happens when you click &quot;Go Live&quot;?</p>
        <ul className="space-y-1 text-xs text-gray-500 list-disc list-inside">
          <li>Your AI employee becomes active immediately</li>
          <li>SMS/Voice: a Twilio number will be provisioned for you</li>
          <li>Instagram/Facebook: you'll connect in Settings after setup</li>
          <li>You can always add or remove channels from Settings</li>
        </ul>
      </div>
    </div>
  )
}
