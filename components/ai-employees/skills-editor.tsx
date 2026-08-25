'use client'

import { useState, type ElementType } from 'react'
import { toast } from 'sonner'
import { SKILL_CATALOG } from '@/lib/skills'
import { CalendarCheck, UserCheck, HelpCircle, Star, Siren, Calculator, BellRing, Sparkles } from 'lucide-react'
import { GlassToggle } from '@/app/(v2)/v2/controls'

// A skill is told apart by its icon, not by a seventh filled colour. v1 gave each of the seven its
// own brand-coloured tile — blue, emerald, violet, yellow, rose, orange, cyan — inside a section that
// already had a hue of its own, which is eight colours to say "these are seven capabilities".
// The tile is the language's own chip square in one hue; the drawing inside it is the distinction.
const SKILL_ICON: Record<string, ElementType> = {
  appointment_booking: CalendarCheck,
  lead_qualification: UserCheck,
  faq_answering: HelpCircle,
  review_request: Star,
  emergency_routing: Siren,
  estimate_request: Calculator,
  appointment_reminders: BellRing,
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
    <div>
      {/* payment_collection has its own dedicated card (locked/settings), rendered separately. */}
      {SKILL_CATALOG.filter((s) => s.type !== 'payment_collection').map((s) => {
        const Icon = SKILL_ICON[s.type] || Sparkles
        return (
          <div key={s.type} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span className="v2-chip-sq" style={{ ['--ghue' as string]: 'var(--v2-t1)', marginTop: 10 }}><Icon /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <GlassToggle
                label={s.name}
                hint={s.description}
                checked={!!active[s.type]}
                disabled={busy === s.type}
                onChange={() => toggle(s.type)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
