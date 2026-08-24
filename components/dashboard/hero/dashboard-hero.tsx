import { RudiPresenceProvider, GlassToasts } from './rudi-presence'
import { V2Hero } from './v2-hero'
import { HomeColumn } from './home-column'
import type { HomeView } from '@/lib/dashboard/home-view'
import { type AmyBriefing } from './ask-amy'
import { AttentionPill } from '@/components/dashboard/attention'
import type { PersonaKey } from '@/lib/persona'

export type PresenceState = 'ready' | 'working' | 'attention'

export interface DashboardHeroProps {
  employeeName: string
  /** Which employee to paint. From the ai_employees row — never assumed. */
  persona: PersonaKey
  presenceState: PresenceState
  briefing: AmyBriefing
  /** Right Now / Needs You / This Month, and the caption's counts. See lib/dashboard/home-view. */
  view: HomeView
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
  briefing,
  view,
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
      {/* THE HERO IS THE FIRST SCREEN, exactly as it is on /v2 — full-bleed, full viewport, nothing
          above it. What used to sit here (the mobile "Dashboard" heading, the business name, the
          on-duty pill, the attention banner) has moved below the fold: /v2 carries identity in the
          portrait and status in the sentence, and stacking v1's chrome on top of that was what made
          this read as the pieces rearranged rather than the screen brought across. */}
      <V2Hero
        persona={persona}
        employeeName={employeeName}
        line={view.line}
        readouts={readouts}
        briefing={briefing}
        aside={<HomeColumn view={view} />}
      />

      {/* NOTHING SCROLLS UNDER THE HERO ANY MORE.
          Two things used to. A 24px "Dashboard" heading over the business name, which is the page
          header the kit already ruled out everywhere else — the rail says which screen this is, and
          the portrait says whose business it is. And TodayWork, the figures a second time on mobile;
          they were only ever here because mobile has no right-hand column, but mobile has the
          readout cards on the hero itself, which is where /v2 puts them. Both were the last of "the
          pieces arranged into v1's layout".
          The attention pill stays: it is a live signal, not a figure and not a heading. */}
      <section className="relative mx-auto max-w-5xl pt-4 sm:pt-6 sx-animate-in">
        <AttentionPill initialVisible={presenceState === 'attention'} />
        <div className="relative md:hidden"><GlassToasts /></div>
      </section>
    </RudiPresenceProvider>
  )
}
