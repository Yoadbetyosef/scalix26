import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getLifecycleOverview, getCustomerModels, buildOnboardingCases } from '@/lib/command-center/adapters'
import { getOverlays } from '@/lib/command-center/onboarding-overlay'
import { num, pctText, Section } from '@/components/command-center/ui'
import { OnboardingQueue } from '@/components/command-center/onboarding-queue'

export const dynamic = 'force-dynamic'

const STAGE_LABEL: Record<string, string> = {
  signed_up: 'Signed up', payment_complete: 'Payment complete', setup_complete: 'Setup complete',
  technically_live: 'Technically live', activated: 'Activated', adopted: 'Adopted',
}

// Onboarding — HONEST funnel plus the operational queue. A stage is only "done" when the data proves it;
// otherwise Unknown. The queue's manual overlay is a human operating layer ON TOP of the observed stage and
// never mutates it, so the two are always shown side by side and kept visually distinct.
export default async function OnboardingPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()

  const [o, models, overlays] = await Promise.all([getLifecycleOverview(), getCustomerModels(), getOverlays()])
  const f = o.onboarding
  const cases = buildOnboardingCases(models, overlays)

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Onboarding</h2>
        <p className="text-sm text-subtle">
          System-observed stages (proven from data) with an Unknown layer where the checklist can&apos;t confirm a step.
          Checklist coverage: <span className="font-medium text-ink">{pctText(f.completionCoverage)}</span> — the rest show Unknown, not Complete.
        </p>
      </div>

      <Section title="Observed funnel" subtitle={`${num(f.total)} customers · a later stage only implies an earlier one when the business sequence guarantees it.`}>
        <div className="overflow-x-auto rounded-xl border border-hairline-strong">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-subtle"><tr>{['Stage', 'Proven (done)', 'Unknown', 'Not reached'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              {f.cells.map((c) => (
                <tr key={c.stage}>
                  <td className="px-3 py-2 font-medium text-ink">{STAGE_LABEL[c.stage]}</td>
                  <td className="px-3 py-2 tabular-nums text-emerald-600">{c.done}</td>
                  <td className="px-3 py-2 tabular-nums text-amber-600">{c.unknown || '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-subtle">{c.notReached || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {f.unknownStages.length > 0 && (
          <p className="mt-2 text-xs text-amber-700">⚠ Unknown coverage on: {f.unknownStages.map((s) => STAGE_LABEL[s]).join(', ')} — instrument these steps to turn Unknown into Proven.</p>
        )}
      </Section>

      <Section title="Operational queue" subtitle="Every account not yet adopted. The Observed column is proven from data; the Manual stage and all overlay fields are your operating layer and never change what the system observed.">
        <OnboardingQueue cases={cases} />
      </Section>
    </div>
  )
}
