'use client'

import { useState } from 'react'
import type { ImpactData, AttentionItem } from '@/lib/dashboard/impact'
import { DrillDownDrawer, type DrawerConfig } from '@/components/dashboard/drill-down-drawer'
import { AttentionNeeded } from '@/components/dashboard/attention-needed'

// WHAT IS LEFT OF THE BELOW-FOLD DASHBOARD: ONE THING, AND IT IS A WORK QUEUE.
//
// The hero owns the viewport and its right column carries the month's figures, so everything that
// restated them went first — "What Would Have Happened Without <brand>", the four impact metric
// cards, "Your AI Employee This Month", the month label. Business Brain followed, card and heading:
// it was the last panel here, and a dashboard whose job is "what needs you now" is not where a
// standing summary of what the AI has learned belongs.
//
// Attention Needed stays, and is the reason this component still exists. It is not a figure restated
// somewhere else — it is the list of things a person has to act on, and it is the only one.
export function ImpactDashboard({ data, tenantId }: { data: ImpactData; tenantId: string }) {
  // Drill-down drawer (proof). Attention Needed still opens it; the four metric cards that used
  // to are gone.
  const [drawer, setDrawer] = useState<DrawerConfig | null>(null)

  return (
    <div className="space-y-5 md:space-y-8">
      {/* Full width now that nothing sits beside it. The id and scroll-mt are the anchor the
          notification bell and the voice assistant deep-link to — they must survive. */}
      <div id="attention-needed" className="scroll-mt-20">
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

      {/* Drill-down proof drawer (lazy-loads real records when opened) */}
      <DrillDownDrawer config={drawer} onClose={() => setDrawer(null)} />
    </div>
  )
}
