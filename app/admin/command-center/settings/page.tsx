import { AssumptionsEditor } from '@/components/command-center/assumptions-editor'

export const dynamic = 'force-dynamic'

export default function CommandCenterSettings() {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Assumptions</h2>
        <p className="text-sm text-subtle">The operating model. Every edit is versioned and audited, and never overwrites actuals. Preview recalculates before you save.</p>
      </div>
      <AssumptionsEditor />
    </div>
  )
}
