'use client'

import { useState } from 'react'
import type { ImpactData, AttentionItem } from '@/lib/dashboard/impact'
import { DrillDownDrawer, type DrawerConfig } from '@/components/dashboard/drill-down-drawer'
import { BusinessBrainCard } from '@/components/dashboard/business-brain-card'
import { AttentionNeeded } from '@/components/dashboard/attention-needed'

// WHAT IS LEFT OF THE BELOW-FOLD DASHBOARD.
//
// The hero owns the viewport and its right column carries the month's figures, so the three sections
// that restated them are gone: "What Would Have Happened Without <brand>", the four impact metric
// cards, and "Your AI Employee This Month". The month label went with them — the right column already
// says which month it is. What remains is the two things that are not figures: Attention Needed, which
// is a work queue, and Business Brain, which is its own feature with its own entry point.
export function ImpactDashboard({ data, brainAgentId, tenantId }: { data: ImpactData; brainAgentId?: string; tenantId: string }) {
  // Drill-down drawer (proof). Attention Needed still opens it; the four metric cards that used
  // to are gone.
  const [drawer, setDrawer] = useState<DrawerConfig | null>(null)

  return (
    <div className="space-y-5 md:space-y-8">
      {/* ATTENTION NEEDED + BUSINESS BRAIN — side by side, under the numbers */}
      <div id="attention-needed" className="grid gap-4 md:grid-cols-2 md:items-start scroll-mt-20">
      <div>
        <h2 className="text-lg sm:text-xl font-normal text-ink mb-3">Attention Needed</h2>
        <AttentionNeeded
          items={data.attention}
          tenantId={tenantId}
          onOpenMetric={(item: AttentionItem) => {
            const n = parseInt(item.label, 10) || 0
            const meta = item.metric === 'attention_takeover'
              ? { title: "Conversations You're Handling", subtitle: "Open conversations you've stepped into." }
              : { title: 'Leads Awaiting Follow-up', subtitle: "Leads that haven't been contacted yet." }
            setDrawer({ metric: item.metric!, title: meta.title, subtitle: meta.subtitle, headerCount: `${n}` })
          }}
        />
      </div>
      {brainAgentId && (
        <div>
          <h2 className="text-lg sm:text-xl font-normal text-ink mb-3">Business Brain</h2>
          <BusinessBrainCard agentId={brainAgentId} />
        </div>
      )}
      </div>

      {/* Drill-down proof drawer (lazy-loads real records when opened) */}
      <DrillDownDrawer config={drawer} onClose={() => setDrawer(null)} />
    </div>
  )
}
