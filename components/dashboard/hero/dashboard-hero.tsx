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

      {/* NOTHING SCROLLS UNDER THE HERO — AND NOW THAT IS LITERALLY TRUE.
          Three things used to sit below it and all three have gone somewhere better: the page
          header (the rail says which screen this is), TodayWork (the figures are in the right
          column, and on a phone on the hero's own readout cards), and Attention Needed (the NEEDS
          YOU card, which was already asking the same question).

          What is left is mobile-only — the attention pill and the toasts — and it FLOATS. As a
          sibling section it was a block under a 100dvh hero, which made the dashboard 1,860px tall
          on a phone to carry one 48px banner. Fixed, just under the hero's own top strip, it costs
          the page nothing and sits where a banner belongs: at the top, over the picture, not below
          the fold of a screen designed to have no fold.

          Desktop renders none of it: both children are md:hidden, so the section was an empty box
          with padding taking up space under the hero for no reason. */}
      <section className="md:hidden fixed left-0 right-0 z-30 px-4 sx-animate-in"
               style={{ top: 'calc(56px + env(safe-area-inset-top))' }}>
        <AttentionPill initialVisible={presenceState === 'attention'} />
        <GlassToasts />
      </section>
    </RudiPresenceProvider>
  )
}
