import { notFound } from 'next/navigation'
import { DashboardHero } from '@/components/dashboard/hero/dashboard-hero'
import { ProbeReport } from '@/app/(v2)/v2/render-probe/probe-report'
import type { AmyBriefing } from '@/components/dashboard/hero/ask-amy-shared'

// The REAL DashboardHero, with stub inputs, in a v1 page.
//
// This exists because of a bug it would have caught. Every render that approved the robot was of the
// orb on its own; nobody rendered the row he sits in, so a photograph of a woman at 36px overlapping
// him at 112px reached two customers. A probe that renders a component proves the component. Only a
// probe that renders the screen proves the screen.
//
// Stub inputs, real component tree — including the floating Talk bar AskAmy portals to the body.
// Dev only. See ../orb/page.tsx.

export const dynamic = 'force-dynamic'

const BRIEFING: AmyBriefing = {
  employeeName: 'Amy',
  employeeVoice: 'aura-2-asteria-en',
  handled: 12,
  booked: 3,
  recovered: 2,
  coverage: 92,
  // Three, so rudiLine produces a caption the same length as /v2's probe stub — the caption box
  // is bottom-anchored, so an unequal sentence shows up as an unequal top edge and reads as a
  // layout difference when it is only a data one.
  attention: [
    { label: '1 lead has not been answered', href: '/inbox' },
    { label: 'A quote is waiting on you', href: '/orders' },
    { label: 'An invoice is overdue', href: '/invoices' },
  ],
  leadsAwaiting: 1,
  waitingOnYou: 1,
  callsAnswered: 3,
  textsHandled: 4,
  appointmentsToday: 12,
}

export default function DashboardProbe() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <DashboardHero
        employeeName="Amy"
        persona="rudi"
        presenceState="attention"
        businessName="T.G. Jewellers"
        figures={[
          { label: 'Recovered', value: 2 },
          { label: 'Handled', value: 12 },
          { label: 'Booked', value: 3 },
          { label: 'Coverage', value: 92, suffix: '%' },
        ]}
        briefing={BRIEFING}
      />
      <div className="flex gap-1 border-b border-hairline">
        <span className="inline-block border-b-2 border-ink px-4 py-2.5 text-sm font-medium text-ink">Overview</span>
        <span className="inline-block px-4 py-2.5 text-sm font-medium text-muted">Leads</span>
        <span className="inline-block px-4 py-2.5 text-sm font-medium text-muted">Appointments</span>
      </div>
      <div className="rounded-xl border border-hairline p-6 text-sm text-muted">The tables below the tabs sit here.</div>
      {/* The SAME reporter /v2's probe uses, so the two screens are measured by one instrument
          rather than by two descriptions. It queries the DOM by class and cares nothing for
          which route it is on. */}
      <ProbeReport force="idle" />
    </div>
  )
}
