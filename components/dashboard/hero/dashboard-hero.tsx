import Link from 'next/link'
import { Plus } from 'lucide-react'
import { RudiPresenceProvider, GlassToasts } from './rudi-presence'
import { V2Hero } from './v2-hero'
import { TodayWork, type WorkFigure } from './today-work'
import { type AmyBriefing } from './ask-amy'
import { AttentionPill } from '@/components/dashboard/attention'
import type { PersonaKey } from '@/lib/persona'

export type PresenceState = 'ready' | 'working' | 'attention'

export interface DashboardHeroProps {
  employeeName: string
  /** Which employee to paint. From the ai_employees row — never assumed. */
  persona: PersonaKey
  presenceState: PresenceState
  stateSentence: string
  idleSentence: string
  businessName: string
  phone?: string | null
  figures: WorkFigure[]
  briefing: AmyBriefing
  tenantId?: string
}

/**
 * The dashboard hero — /v2's home composition, on v1's data.
 *
 * This used to be an orb, a headshot, a sentence and a row of figures arranged around them. It is now
 * the screen /v2 spent a month becoming: the portrait full-bleed, the scan running on it, the
 * sentence over the picture, the readouts cycling, and the Talk button that opens the same session
 * the old one did.
 *
 * WHAT IT DOES IS UNCHANGED. Every number comes from buildHeroInputs and the two queries the
 * dashboard already ran; the voice session is useAmySession, which /v2 was calling anyway. No new
 * query, no new source, no second opinion about any figure on the page.
 *
 * What went: the orb, the avatar beside it, and the identity eyebrow. The portrait says who he is at
 * full height, and a 36px headshot of a different character beside it was the bug that shipped.
 */
export function DashboardHero({
  employeeName,
  persona,
  presenceState,
  stateSentence,
  idleSentence,
  businessName,
  phone,
  figures,
  briefing,
  tenantId,
}: DashboardHeroProps) {
  // The readouts, from figures the page already has. CARDS in readout-cards.ts is a literal — the
  // same six numbers for every tenant — which is fine in a design preview and not fine here.
  const pct = briefing.coverage === null ? '—' : `${Math.round(briefing.coverage)}%`
  const readouts: Array<Array<[string, string]>> = [
    [['CALLS ANSWERED', String(briefing.callsAnswered)], ['ANSWERED', pct]],
    [['WAITING ON YOU', String(briefing.waitingOnYou ?? briefing.leadsAwaiting)], ['BOOKED', String(briefing.booked)]],
    [['HANDLED', String(briefing.handled)], ['TODAY', String(briefing.appointmentsToday)]],
  ]

  return (
    <RudiPresenceProvider tenantId={tenantId}>
      <section className="relative sx-animate-in">
        <div className="absolute right-0 top-0 z-10 hidden md:block">
          <Link
            href="/ai-employees/new"
            className="inline-flex items-center gap-1.5 rounded-button px-2 py-1 text-sm text-subtle transition-colors hover:text-ink"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New AI Employee</span>
            <span className="sm:hidden">New</span>
          </Link>
        </div>

        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-start justify-between pr-12 md:hidden">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-ink">Dashboard</h1>
              {businessName && <p className="mt-0.5 truncate text-sm text-muted">{businessName}</p>}
            </div>
            <span className="ml-3 inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {employeeName} on duty
            </span>
          </div>

          <AttentionPill initialVisible={presenceState === 'attention'} />

          <V2Hero
            persona={persona}
            employeeName={employeeName}
            sentence={presenceState === 'attention' ? stateSentence : idleSentence}
            readouts={readouts}
            phone={phone}
            briefing={briefing}
          />

          {/* The day's numbers stay. They are the same figures the readouts sample, at rest and in
              full, for the person who wants to read rather than watch. */}
          <div className="relative mt-6">
            <GlassToasts />
            <TodayWork figures={figures} />
          </div>
        </div>
      </section>
    </RudiPresenceProvider>
  )
}
