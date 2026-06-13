'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

// Each field is stored as a knowledge_base entry (source 'template') scoped to
// THIS agent, so it loads on the agent's calls/texts but not other agents'.
const FIELDS = [
  { title: 'Pricing', label: '💰 Pricing', placeholder: 'e.g. Standard lockout: $95, Car lockout: $125, Key duplication: $45' },
  { title: 'Service Areas', label: '📍 Service Areas', placeholder: 'e.g. Bergen County, Passaic County, Hudson County NJ' },
  { title: "What We Don't Do", label: "❌ What we DON'T do", placeholder: 'e.g. No BMW key programming, No safe cracking' },
] as const

export function BusinessDetails({
  tenantId,
  agentId,
  initial,
}: {
  tenantId: string
  agentId: string
  initial: Record<string, string>
}) {
  const router = useRouter()
  const supabase = createClient()
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const f of FIELDS) v[f.title] = initial[f.title] || ''
    return v
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      for (const f of FIELDS) {
        await supabase.from('knowledge_base').delete()
          .eq('tenant_id', tenantId).eq('ai_employee_id', agentId).eq('source', 'template').eq('title', f.title)
        const content = values[f.title].trim()
        if (content) {
          const { error } = await supabase.from('knowledge_base')
            .insert({ tenant_id: tenantId, ai_employee_id: agentId, title: f.title, content, source: 'template' })
          if (error) throw error
        }
      }
      toast.success('Business details saved!')
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {FIELDS.map((f) => (
        <div key={f.title}>
          <Label>{f.label}</Label>
          <Textarea className="mt-1.5" rows={3} placeholder={f.placeholder}
            value={values[f.title]} onChange={(e) => setValues((v) => ({ ...v, [f.title]: e.target.value }))} />
        </div>
      ))}
      <Button onClick={save} loading={saving} className="w-full sm:w-auto">Save Business Details</Button>
    </div>
  )
}
