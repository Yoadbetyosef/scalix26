'use client'

import { Switch } from '@/components/ui/switch'
import { WizardState } from './ai-employee-wizard'
import { SkillType } from '@/types'
import {
  Calendar, UserCheck, HelpCircle, Star,
  AlertTriangle, DollarSign, Bell, Globe
} from 'lucide-react'

interface Props {
  data: WizardState
  updateData: (partial: Partial<WizardState>) => void
}

const SKILLS: Array<{
  type: SkillType
  name: string
  description: string
  icon: React.ElementType
  recommended?: boolean
}> = [
  {
    type: 'appointment_booking',
    name: 'Appointment Booking',
    description: 'Collects service type, preferred date/time, address, and contact info to book appointments.',
    icon: Calendar,
    recommended: true,
  },
  {
    type: 'lead_qualification',
    name: 'Lead Qualification',
    description: 'Asks about the problem, urgency (1-10), property type, and size before connecting to your team.',
    icon: UserCheck,
    recommended: true,
  },
  {
    type: 'faq_answering',
    name: 'FAQ Answering',
    description: 'Answers common questions using your knowledge base (hours, pricing, services, etc.).',
    icon: HelpCircle,
    recommended: true,
  },
  {
    type: 'review_request',
    name: 'Review Request',
    description: 'After a completed job, asks customers to leave a Google review with your custom link.',
    icon: Star,
  },
  {
    type: 'emergency_routing',
    name: 'Emergency Routing',
    description: 'Detects emergency keywords and immediately escalates to your emergency line.',
    icon: AlertTriangle,
  },
  {
    type: 'estimate_request',
    name: 'Estimate Request',
    description: 'Collects all info needed for a quote and notifies you instantly.',
    icon: DollarSign,
  },
  {
    type: 'appointment_reminders',
    name: 'Appointment Reminders',
    description: 'Sends SMS reminders 24 hours and 2 hours before scheduled appointments.',
    icon: Bell,
  },
  {
    type: 'bilingual_autodetect',
    name: 'Bilingual Auto-detect',
    description: 'Automatically detects the customer\'s language and responds in the same language (English/Spanish).',
    icon: Globe,
    recommended: true,
  },
]

export function Step4Skills({ data, updateData }: Props) {
  function toggle(type: SkillType) {
    const current = data.activeSkills
    const updated = current.includes(type)
      ? current.filter(s => s !== type)
      : [...current, type]
    updateData({ activeSkills: updated })
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Skills</h2>
        <p className="text-sm text-gray-500">Choose what your AI employee can do. You can change these anytime.</p>
      </div>

      <div className="space-y-3">
        {SKILLS.map(skill => {
          const Icon = skill.icon
          const active = data.activeSkills.includes(skill.type)
          return (
            <div
              key={skill.type}
              className="flex items-start gap-4 p-4 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-[#4ecdc4]/10' : 'bg-gray-100'}`}>
                <Icon className={`w-4 h-4 ${active ? 'text-[#4ecdc4]' : 'text-gray-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">{skill.name}</p>
                  {skill.recommended && (
                    <span className="text-xs bg-[#4ecdc4]/10 text-[#3db8af] px-2 py-0.5 rounded-full">Recommended</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{skill.description}</p>
              </div>
              <Switch
                checked={active}
                onCheckedChange={() => toggle(skill.type)}
                className="flex-shrink-0 mt-0.5"
              />
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-400 text-center">
        {data.activeSkills.length} of {SKILLS.length} skills enabled
      </p>
    </div>
  )
}
