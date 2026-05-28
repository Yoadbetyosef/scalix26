'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tenant, SkillType, ChannelType } from '@/types'
import { Step1BusinessInfo } from './step1-business-info'
import { Step2CreateEmployee } from './step2-create-employee'
import { Step3KnowledgeBase } from './step3-knowledge-base'
import { Step4Skills } from './step4-skills'
import { Step5Channels } from './step5-channels'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

const STEPS = [
  { id: 1, title: 'Business Info' },
  { id: 2, title: 'Create AI Employee' },
  { id: 3, title: 'Knowledge Base' },
  { id: 4, title: 'Skills' },
  { id: 5, title: 'Channels' },
]

export interface WizardState {
  businessInfo: Partial<Tenant>
  employee: {
    name: string
    avatar_url: string
    voice: string
    greeting: string
    personality_score: number
  }
  knowledgeItems: Array<{ title: string; content: string; source: string }>
  activeSkills: SkillType[]
  activeChannels: ChannelType[]
}

const DEFAULT_STATE: WizardState = {
  businessInfo: {},
  employee: {
    name: 'Alex',
    avatar_url: '/avatars/avatar-1.png',
    voice: 'professional_female',
    greeting: "Hi! Thank you for contacting us. How can I help you today?",
    personality_score: 70,
  },
  knowledgeItems: [],
  activeSkills: ['appointment_booking', 'lead_qualification', 'faq_answering', 'bilingual_autodetect'],
  activeChannels: ['sms'],
}

export function AIEmployeeWizard({ tenant }: { tenant: Tenant }) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<WizardState>(DEFAULT_STATE)
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  function updateData(partial: Partial<WizardState>) {
    setData(prev => ({ ...prev, ...partial }))
  }

  async function handleFinish() {
    setSaving(true)
    try {
      // 1. Update tenant with business info
      await supabase.from('tenants').update({
        ...data.businessInfo,
      }).eq('id', tenant.id)

      // 2. Create AI employee
      const { data: employee, error: empError } = await supabase
        .from('ai_employees')
        .insert({
          tenant_id: tenant.id,
          name: data.employee.name,
          avatar_url: data.employee.avatar_url,
          voice: data.employee.voice,
          greeting: data.employee.greeting,
          personality_score: data.employee.personality_score,
          status: 'active',
        })
        .select()
        .single()

      if (empError) throw empError

      // 3. Create knowledge base items
      if (data.knowledgeItems.length > 0) {
        await supabase.from('knowledge_base').insert(
          data.knowledgeItems.map(item => ({
            tenant_id: tenant.id,
            ai_employee_id: employee.id,
            ...item,
          }))
        )
      }

      // 4. Create skills
      const SKILL_LABELS: Record<SkillType, string> = {
        appointment_booking: 'Appointment Booking',
        lead_qualification: 'Lead Qualification',
        faq_answering: 'FAQ Answering',
        review_request: 'Review Request',
        emergency_routing: 'Emergency Routing',
        estimate_request: 'Estimate Request',
        appointment_reminders: 'Appointment Reminders',
        bilingual_autodetect: 'Bilingual Auto-detect',
      }

      await supabase.from('skills').insert(
        data.activeSkills.map(type => ({
          tenant_id: tenant.id,
          ai_employee_id: employee.id,
          name: SKILL_LABELS[type],
          type,
          active: true,
        }))
      )

      // 5. Create channels
      for (const channelType of data.activeChannels) {
        await supabase.from('channels').insert({
          tenant_id: tenant.id,
          ai_employee_id: employee.id,
          type: channelType,
          status: 'pending',
        })
      }

      toast.success('AI Employee created successfully! 🎉')
      router.push('/dashboard')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create AI Employee')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 bg-[#4ecdc4] rounded-lg flex items-center justify-center">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Create AI Employee</h1>
          <p className="text-sm text-gray-500">Set up your 24/7 AI customer service agent</p>
        </div>
      </div>

      {/* Step Progress */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                  step > s.id
                    ? 'bg-[#4ecdc4] text-white'
                    : step === s.id
                    ? 'bg-[#1a1f36] text-white'
                    : 'bg-gray-200 text-gray-500'
                )}
              >
                {step > s.id ? <Check className="w-4 h-4" /> : s.id}
              </div>
              <span className={cn('text-xs mt-1 hidden sm:block', step === s.id ? 'text-gray-900 font-medium' : 'text-gray-400')}>
                {s.title}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('h-0.5 flex-1 mx-1', step > s.id ? 'bg-[#4ecdc4]' : 'bg-gray-200')} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        {step === 1 && <Step1BusinessInfo tenant={tenant} data={data} updateData={updateData} />}
        {step === 2 && <Step2CreateEmployee data={data} updateData={updateData} />}
        {step === 3 && <Step3KnowledgeBase tenant={tenant} data={data} updateData={updateData} />}
        {step === 4 && <Step4Skills data={data} updateData={updateData} />}
        {step === 5 && <Step5Channels data={data} updateData={updateData} />}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep(s => s - 1)}
          disabled={step === 1}
        >
          Back
        </Button>
        {step < 5 ? (
          <Button onClick={() => setStep(s => s + 1)}>
            Continue →
          </Button>
        ) : (
          <Button onClick={handleFinish} loading={saving}>
            Go Live 🚀
          </Button>
        )}
      </div>
    </div>
  )
}
