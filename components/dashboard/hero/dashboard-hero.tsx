import Link from 'next/link'
import { Plus } from 'lucide-react'
import { RudiPresenceProvider, GlassToasts } from './rudi-presence'
import { RudiOrb } from './rudi-orb'
import { RudiBand } from './rudi-band'
import { STATUS_META, type EmployeeStatus } from '@/lib/employee'
import { cn } from '@/lib/utils'
import { TodayWork, type WorkFigure } from './today-work'
import { AskAmy, type AmyBriefing } from './ask-amy'
import { AttentionSentence, AttentionPill } from '@/components/dashboard/attention'

export type PresenceState = 'ready' | 'working' | 'attention'

export interface DashboardHeroProps {
  employeeName: string
  presenceState: PresenceState
  stateSentence: string
  idleSentence: string
  businessName: string
  figures: WorkFigure[]
  briefing: AmyBriefing
  tenantId?: string
}

/**
 * The dashboard hero — the same world as /auth/login, and the dominant first viewport.
 * The living waveform AI presence, the employee's spoken status in thin Apple
 * typography, and the day's key numbers — large and calm. Details live below the fold;
 * the primary story owns the first screen. Color lives only in the waveform.
 */
export function DashboardHero({
  employeeName,
  presenceState,
  stateSentence,
  idleSentence,
  businessName,
  figures,
  briefing,
  tenantId,
}: DashboardHeroProps) {
  const status: EmployeeStatus = presenceState === 'attention' ? 'attention' : 'on_duty'
  const eyebrow = businessName ? `${employeeName} · AI Employee · ${businessName}` : `${employeeName} · AI Employee`

  return (
    <RudiPresenceProvider tenantId={tenantId}>
    <section className="relative py-3 md:py-8 sx-animate-in">
      {/* The one preserved action — a quiet whisper in the corner. Desktop only:
          on mobile the app header (below) owns the top, matching the design. */}
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
        {/* Mobile app header — "Dashboard" + business name, and the on-duty pill.
            The bell is the fixed notification icon at the top-right corner (pr-12 leaves
            room for it). Desktop keeps its own identity row below. */}
        <div className="mb-4 flex items-start justify-between pr-12 md:hidden">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Dashboard</h1>
            {businessName && <p className="mt-0.5 truncate text-sm text-muted">{businessName}</p>}
          </div>
          {/* Always the green status pill — the amber banner below is the single attention
              entry point, so we don't duplicate the alert here. */}
          <span className="ml-3 inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {employeeName} on duty
          </span>
        </div>

        {/* B5 — attention banner, reactive to the single source (mobile only). */}
        <AttentionPill initialVisible={presenceState === 'attention'} />

        {/* THE BAND. Mobile only, and where the 144px orb used to be.
            /v2's hero owns a whole viewport; a dashboard scrolls and cannot spare one, so the band
            keeps the picture and gives the copy away — the sentence is on paper directly below, which
            is the move that makes this simple. He is full-bleed here: the page's p-4 is cancelled so
            he reaches both edges. See rudi-band.tsx for why the height is a clamp. */}
        <div className="md:hidden">
          <RudiBand />
        </div>

        {/* The sentence, on paper, under the picture. Mobile had no sentence at all before — just the
            pill — because the orb said nothing and there was nowhere for words to go. It is the same
            component the desktop identity row uses, so both surfaces say the same thing from the same
            source. And it is why nothing here needs a scrim: white text on a photograph is what cost
            last week, and this is ink on a page. */}
        <h2 className="mt-4 text-balance text-xl font-light leading-snug tracking-tight text-ink md:hidden">
          <AttentionSentence initial={stateSentence} idleSentence={idleSentence} />
        </h2>

        {/* Identity — the AI presence + who's on duty (compact). Desktop only; mobile uses the
            compact row above. Smaller here: 96px base, 112px at sm:, which puts his face at 21 and
            24px — the silhouette and the lit eyes read, the expression does not. */}
        <div className="hidden flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left md:flex">
          <div className="h-24 w-24 flex-shrink-0 sm:h-28 sm:w-28">
            <RudiOrb />
          </div>
          <div className="min-w-0">
            {/* A DOT, NOT A SECOND FACE. This line used to carry EmployeeAvatar — the headshot of
                the chosen voice — beside the waveform orb, which was fine while the orb was an
                abstract lens. It is not fine beside Rudi: two components rendering the same employee
                and disagreeing about what she looks like, a robot at 112px and a photograph of a
                woman at 36px overlapping it.
                The robot carries the identity here. The avatar's other job was the status dot, and
                that is all this is now — the same colour and label from the same source. */}
            <p className="inline-flex items-center gap-2 text-sm text-subtle">
              <span
                className={cn('h-2 w-2 flex-shrink-0 rounded-full', STATUS_META[status].dot)}
                title={STATUS_META[status].label}
                aria-label={STATUS_META[status].label}
              />
              <span>{eyebrow}</span>
            </p>
            <h1 className="mt-2 max-w-xl text-balance text-xl font-light leading-snug tracking-tight text-ink sm:text-2xl lg:text-[26px]">
              <AttentionSentence initial={stateSentence} idleSentence={idleSentence} />
            </h1>
          </div>
        </div>

        {/* Band — Talk to Amy + the day's numbers, both above the fold.
            Mobile: numbers first, then talk. Desktop: talk left, numbers right. */}
        <div className="mt-4 grid gap-x-10 gap-y-4 sm:mt-8 sm:gap-y-7 lg:grid-cols-2 lg:items-center">
          <div className="relative order-2 lg:order-1">
            {/* B7 — ambient glass event toasts float up above the talk area (mobile). */}
            <GlassToasts />
            <AskAmy briefing={briefing} />
          </div>
          <div className="order-1 lg:order-2 lg:border-l lg:border-hairline lg:pl-10">
            <TodayWork figures={figures} />
          </div>
        </div>
      </div>
    </section>
    </RudiPresenceProvider>
  )
}
