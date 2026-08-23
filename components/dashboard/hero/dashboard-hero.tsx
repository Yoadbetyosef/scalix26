import Link from 'next/link'
import { Plus } from 'lucide-react'
import { RudiPresenceProvider, GlassToasts } from './rudi-presence'
import { V2Hero } from './v2-hero'
import { TodayWork, type WorkFigure } from './today-work'
import { type AmyBriefing } from './ask-amy'
import { AttentionPill } from '@/components/dashboard/attention'
import { rudiLine } from '@/app/(v2)/v2/rudi-line'
import type { PersonaKey } from '@/lib/persona'

export type PresenceState = 'ready' | 'working' | 'attention'

export interface DashboardHeroProps {
  employeeName: string
  /** Which employee to paint. From the ai_employees row — never assumed. */
  persona: PersonaKey
  presenceState: PresenceState
  businessName: string
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
  businessName,
  figures,
  briefing,
  tenantId,
}: DashboardHeroProps) {
  // The readouts, from figures the page already has. CARDS in readout-cards.ts is a literal — the
  // same six numbers for every tenant — which is fine in a design preview and not fine here.
  const pct = briefing.coverage === null ? '—' : `${Math.round(briefing.coverage)}%`
  // The caption, from /v2's own generator on v1's counts. Same function, same phrasing, same accent
  // clause — the closing segment is what carries the gradient.
  //
  // ONE CLAUSE IS MISSING and that is deliberate: rudiLine can also say "N new people today", which
  // needs the inbox's arrivals grouping, and reading it here would mean a query the dashboard does
  // not currently make. Omitted rather than approximated from a count that means something else.
  const sentence = rudiLine({
    jobsToday: briefing.appointmentsToday,
    newToday: 0,
    newHandled: 0,
    waiting: briefing.attention.length,
  })

  const readouts: Array<Array<[string, string]>> = [
    [['CALLS ANSWERED', String(briefing.callsAnswered)], ['ANSWERED', pct]],
    [['WAITING ON YOU', String(briefing.waitingOnYou ?? briefing.leadsAwaiting)], ['BOOKED', String(briefing.booked)]],
    [['HANDLED', String(briefing.handled)], ['TODAY', String(briefing.appointmentsToday)]],
  ]

  return (
    <RudiPresenceProvider tenantId={tenantId}>
      {/* THE HERO IS THE FIRST SCREEN, exactly as it is on /v2 — full-bleed, full viewport, nothing
          above it. What used to sit here (the mobile "Dashboard" heading, the business name, the
          on-duty pill, the attention banner) has moved below the fold: /v2 carries identity in the
          portrait and status in the sentence, and stacking v1's chrome on top of that was what made
          this read as the pieces rearranged rather than the screen brought across. */}
      <V2Hero
        persona={persona}
        employeeName={employeeName}
        sentence={sentence}
        readouts={readouts}
        briefing={briefing}
        aside={<TodayWork figures={figures} />}
      />

      <section className="relative mx-auto max-w-5xl pt-4 sm:pt-6 sx-animate-in">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-ink md:text-xl md:font-light">Dashboard</h1>
            {businessName && <p className="mt-0.5 truncate text-sm text-muted">{businessName}</p>}
          </div>
          <Link
            href="/ai-employees/new"
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-button px-2 py-1 text-sm text-subtle transition-colors hover:text-ink"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New AI Employee</span>
            <span className="sm:hidden">New</span>
          </Link>
        </div>

        <AttentionPill initialVisible={presenceState === 'attention'} />

        {/* The figures again, below the fold — on MOBILE only. On desktop they are in the hero's
            right-hand column, where /v2 puts them, and printing them twice on one screen was the
            thing this change exists to stop. */}
        <div className="relative md:hidden">
          <GlassToasts />
          <TodayWork figures={figures} />
        </div>
      </section>
    </RudiPresenceProvider>
  )
}
