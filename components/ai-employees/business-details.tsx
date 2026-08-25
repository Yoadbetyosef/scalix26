'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { DollarSign, MapPin, Ban } from 'lucide-react'
import { GlassInput } from '@/app/(v2)/v2/controls'

// Each field is stored as a knowledge_base entry (source 'template') scoped to
// THIS agent, so it loads on the agent's calls/texts but not other agents'.
// The third field is the only one that carries a hue: "what we don't do" is a boundary, and it is
// the one of the three where getting it wrong makes the AI promise something you cannot deliver.
const FIELDS = [
  { title: 'Pricing', label: 'Pricing', Icon: DollarSign, hue: 'var(--v2-t2)', placeholder: 'e.g. Standard lockout: $95, Car lockout: $125, Key duplication: $45' },
  { title: 'Service Areas', label: 'Service areas', Icon: MapPin, hue: 'var(--v2-t2)', placeholder: 'e.g. Bergen County, Passaic County, Hudson County NJ' },
  { title: "What We Don't Do", label: "What we don’t do", Icon: Ban, hue: 'var(--v2-red)', placeholder: 'e.g. No BMW key programming, No safe cracking' },
] as const

export function BusinessDetails({
  agentId,
  initial,
}: {
  tenantId?: string
  agentId: string
  initial: Record<string, string>
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const f of FIELDS) v[f.title] = initial[f.title] || ''
    return v
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      // Server API scopes the write to the validated active business (owner or operated client).
      const details = Object.fromEntries(FIELDS.map((f) => [f.title, values[f.title]]))
      const res = await fetch(`/api/agents/${agentId}/business-details`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ details }) })
      if (!res.ok) throw new Error('failed')
      toast.success('Business details saved!')
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {FIELDS.map((f) => (
        <div key={f.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span className="v2-chip-sq" style={{ ['--ghue' as string]: f.hue, marginTop: 14 }}><f.Icon /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <GlassInput
              label={f.label}
              multiline
              placeholder={f.placeholder}
              value={values[f.title]}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.title]: v }))}
            />
          </div>
        </div>
      ))}
      <div className="v2-bar" style={{ marginTop: 14 }}>
        <button type="button" onClick={save} disabled={saving} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
          {saving ? 'Saving…' : 'Save business details'}
        </button>
      </div>
    </div>
  )
}
