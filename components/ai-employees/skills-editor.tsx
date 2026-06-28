'use client'

import { useState, type ElementType } from 'react'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { SKILL_CATALOG } from '@/lib/skills'
import { CalendarCheck, UserCheck, HelpCircle, Star, Siren, Calculator, BellRing, Sparkles } from 'lucide-react'

// Each skill wears its own colored tile — the page reads as a team of capabilities,
// not a list of checkboxes.
const SKILL_META: Record<string, { icon: ElementType; tone: string }> = {
  appointment_booking: { icon: CalendarCheck, tone: 'bg-blue-500' },
  lead_qualification: { icon: UserCheck, tone: 'bg-emerald-500' },
  faq_answering: { icon: HelpCircle, tone: 'bg-violet-500' },
  review_request: { icon: Star, tone: 'bg-yellow-500' },
  emergency_routing: { icon: Siren, tone: 'bg-rose-500' },
  estimate_request: { icon: Calculator, tone: 'bg-orange-500' },
  appointment_reminders: { icon: BellRing, tone: 'bg-cyan-500' },
}

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
      {SKILL_CATALOG.map((s) => {
        const meta = SKILL_META[s.type] || { icon: Sparkles, tone: 'bg-slate-500' }
        const Icon = meta.icon
        return (
          <div key={s.type} className="flex items-start gap-3 p-3.5 rounded-2xl border border-hairline transition-shadow hover:shadow-e1">
            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-[10px] ${meta.tone} text-white shadow-e1 flex-shrink-0`}>
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink">{s.name}</p>
              <p className="text-xs text-subtle">{s.description}</p>
            </div>
            <Switch checked={!!active[s.type]} onCheckedChange={() => toggle(s.type)} disabled={busy === s.type} className="flex-shrink-0 mt-1" />
          </div>
        )
      })}
    </div>
  )
}
