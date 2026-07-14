import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getMission } from '@/lib/command-center/mission-adapter'
import { getOperatingPlan } from '@/lib/command-center/operating-plan-store'
import { Section } from '@/components/command-center/ui'
import { MissionView } from '@/components/command-center/mission-view'
import { OperatingPlanBoard } from '@/components/command-center/operating-plan-board'

export const dynamic = 'force-dynamic'

// Mission — the path from current REALITY to the company target. Current values are Derived Actual; the
// required path is a deterministic Forecast/Estimate (labeled). Targets and milestones are editable.
export default async function MissionPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const [mission, plan] = await Promise.all([getMission(), getOperatingPlan()])

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Mission</h2>
        <p className="text-sm text-subtle">Where we are (reality) → where we&apos;re going (target) → what must happen (required path). Model-based requirements are labeled Forecast/Estimate — never shown as booked results.</p>
      </div>

      <Section title="Milestones, required path & ARR waterfall" subtitle="Current is Derived Actual; targets are editable; the required path is a projection.">
        <MissionView mission={mission} />
      </Section>

      <Section title="Operating Plan" subtitle="Cascade the mission into owned, dated objectives.">
        <OperatingPlanBoard rows={plan} />
      </Section>
    </div>
  )
}
