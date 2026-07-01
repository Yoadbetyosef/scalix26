'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { DollarSign, MapPin, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

// Each field is stored as a knowledge_base entry (source 'template') scoped to
// THIS agent, so it loads on the agent's calls/texts but not other agents'.
// Brand icon tiles (no emoji) — colored to match meaning: pricing = green, areas =
// accent/blue, don't-do = danger/red.
const FIELDS = [
  { title: 'Pricing', label: 'Pricing', Icon: DollarSign, tile: 'bg-emerald-50 text-emerald-600', placeholder: 'e.g. Standard lockout: $95, Car lockout: $125, Key duplication: $45' },
  { title: 'Service Areas', label: 'Service Areas', Icon: MapPin, tile: 'bg-accent/10 text-accent-strong', placeholder: 'e.g. Bergen County, Passaic County, Hudson County NJ' },
  { title: "What We Don't Do", label: "What we don’t do", Icon: Ban, tile: 'bg-danger/10 text-danger', placeholder: 'e.g. No BMW key programming, No safe cracking' },
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
          <Label className="flex items-center gap-2 text-sm font-medium text-ink">
            <span className={`flex h-6 w-6 items-center justify-center rounded-md ${f.tile}`}><f.Icon className="h-3.5 w-3.5" /></span>
            {f.label}
          </Label>
          <Textarea className="mt-1.5" rows={3} placeholder={f.placeholder}
            value={values[f.title]} onChange={(e) => setValues((v) => ({ ...v, [f.title]: e.target.value }))} />
        </div>
      ))}
      <Button onClick={save} loading={saving} className="w-full sm:w-auto">Save Business Details</Button>
    </div>
  )
}
