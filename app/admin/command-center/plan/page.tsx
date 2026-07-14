import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getPlanNavigation } from '@/lib/command-center/plan-adapter'
import { PlanView } from '@/components/command-center/plan-view'

export const dynamic = 'force-dynamic'

// Plan — the business navigation system. The founder sets only the destination; the system calculates
// everything backward from reality → today's actions. Recomputed every load (dynamic). Goal → Reality → Gap
// → Today's execution. Deeper surfaces (Mission / War Room / Scoreboard) are the advanced sub-tabs.
export default async function PlanPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const nav = await getPlanNavigation()

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Plan</h2>
        <p className="text-sm text-subtle">Set the destination — the system works backward from your real numbers to exactly what must happen today. Everything recalculates as reality, pricing, ARPU, churn or allocation change.</p>
      </div>
      <PlanView nav={nav} />
    </div>
  )
}
