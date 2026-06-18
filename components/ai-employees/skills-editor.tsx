'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { SKILL_CATALOG } from '@/lib/skills'

// Skill toggles for an agent (moved off the old wizard step 4). Each toggle persists
// immediately to the `skills` table so AI behavior updates without a separate save.
export function SkillsEditor({ agentId, initial }: { agentId: string; initial: { type: string; active: boolean }[] }) {
  const initActive: Record<string, boolean> = {}
  for (const s of initial) initActive[s.type] = s.active
  const [active, setActive] = useState<Record<string, boolean>>(initActive)
  const [busy, setBusy] = useState<string | null>(null)

  async function toggle(type: string) {
    const next = !active[type]
    setActive((a) => ({ ...a, [type]: next })) // optimistic
    setBusy(type)
    try {
      const res = await fetch(`/api/agents/${agentId}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, active: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setActive((a) => ({ ...a, [type]: !next })) // revert
      toast.error('Could not update skill')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2.5">
      {SKILL_CATALOG.map((s) => (
        <div key={s.type} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">{s.name}</p>
            <p className="text-xs text-gray-500">{s.description}</p>
          </div>
          <Switch checked={!!active[s.type]} onCheckedChange={() => toggle(s.type)} disabled={busy === s.type} className="flex-shrink-0 mt-1" />
        </div>
      ))}
    </div>
  )
}
