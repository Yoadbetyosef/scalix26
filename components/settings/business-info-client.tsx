'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

// Each field is stored as a tenant-wide knowledge_base entry (source 'template',
// no ai_employee_id) so it applies to every AI employee on the tenant.
const FIELDS = [
  { title: 'Pricing', label: '💰 Pricing', placeholder: 'e.g. Standard lockout: $95, Car lockout: $125, Key duplication: $45' },
  { title: 'Service Areas', label: '📍 Service Areas', placeholder: 'e.g. Bergen County, Passaic County, Hudson County NJ' },
  { title: "What We Don't Do", label: "❌ What we DON'T do", placeholder: 'e.g. No BMW key programming, No safe cracking' },
] as const

export function BusinessInfoClient({
  tenantId,
  initial,
}: {
  tenantId: string
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
        // Replace the existing tenant-wide template entry for this title.
        await supabase.from('knowledge_base').delete()
          .eq('tenant_id', tenantId).eq('source', 'template').is('ai_employee_id', null).eq('title', f.title)
        const content = values[f.title].trim()
        if (content) {
          const { error } = await supabase.from('knowledge_base')
            .insert({ tenant_id: tenantId, ai_employee_id: null, title: f.title, content, source: 'template' })
          if (error) throw error
        }
      }
      toast.success('Business info saved!')
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="text-gray-400 hover:text-gray-600"><ArrowLeft className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Business Info</h1>
          <p className="text-sm text-gray-500 mt-0.5">Facts every AI employee uses to answer customers.</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Knowledge</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {FIELDS.map((f) => (
            <div key={f.title}>
              <Label>{f.label}</Label>
              <Textarea className="mt-1.5" rows={3} placeholder={f.placeholder}
                value={values[f.title]} onChange={(e) => setValues((v) => ({ ...v, [f.title]: e.target.value }))} />
            </div>
          ))}
          <p className="text-xs text-gray-400">⏰ Business Hours are set on each AI Employee&apos;s page.</p>
          <Button onClick={save} loading={saving} className="w-full sm:w-auto">Save</Button>
        </CardContent>
      </Card>
    </div>
  )
}
