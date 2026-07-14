import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getWarRoom } from '@/lib/command-center/war-room-adapter'
import { Section } from '@/components/command-center/ui'
import { WarRoomView } from '@/components/command-center/war-room-view'

export const dynamic = 'force-dynamic'

// War Room — the daily execution screen. Tasks are generated from real gaps (actual vs target/plan/capacity/
// risk), read-only until the founder accepts one. No generic to-do list; no fabricated work.
export default async function WarRoomPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const { gaps, tasks } = await getWarRoom()

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">War Room</h2>
        <p className="text-sm text-subtle">What needs to happen Today / This Week / This Month — driven by live gaps between actual, target, plan, capacity and risk.</p>
      </div>
      <Section title="Execution" subtitle="Accept a generated gap to track it, then Start / Done / Dismiss. History is retained and audited.">
        <WarRoomView gaps={gaps} tasks={tasks} />
      </Section>
    </div>
  )
}
