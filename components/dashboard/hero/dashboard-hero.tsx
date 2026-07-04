import Link from 'next/link'
import { Plus, AlertTriangle, ChevronRight } from 'lucide-react'
import { RudiPresenceProvider, LiveOrb, GlassToasts } from './rudi-presence'
import { EmployeeAvatar } from '@/components/ai-employees/employee-avatar'
import type { EmployeeStatus } from '@/lib/employee'
import { TodayWork, type WorkFigure } from './today-work'
import { AskAmy, type AmyBriefing } from './ask-amy'

export type PresenceState = 'ready' | 'working' | 'attention'

export interface DashboardHeroProps {
  employeeName: string
  employeeVoice?: string | null
  presenceState: PresenceState
  stateSentence: string
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
  employeeVoice,
  presenceState,
  stateSentence,
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
          <span
            className={`ml-3 inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium ${
              status === 'attention' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${status === 'attention' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            {employeeName} {status === 'attention' ? 'needs you' : 'on duty'}
          </span>
        </div>

        {/* B5 — attention pill, between the header and the orb (mobile only). */}
        {presenceState === 'attention' && (
          <a
            href="#attention-needed"
            className="mb-4 flex min-h-[48px] items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-left text-amber-900 transition-colors active:bg-amber-100 md:hidden"
          >
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" strokeWidth={2} />
            <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug">{stateSentence}</span>
            <ChevronRight className="h-5 w-5 flex-shrink-0 text-amber-500" />
          </a>
        )}

        {/* B3 orb centerpiece (~112px), standalone and centered. The avatar + pulse rings
            live in the bottom action row (Talk to Rudi), per the design. Only the orb
            container is sized — the waveform animation itself is untouched. */}
        <div className="flex justify-center md:hidden">
          <div className="h-28 w-28 flex-shrink-0">
            <LiveOrb />
          </div>
        </div>

        {/* Identity — the AI presence + who's on duty (compact). Desktop only; mobile
            uses the compact row above. Pixel-identical to the original at md:+
            (only `flex` → `hidden md:flex`; all sm: classes still resolve at md:+). */}
        <div className="hidden flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left md:flex">
          <div className="h-24 w-24 flex-shrink-0 sm:h-28 sm:w-28">
            <LiveOrb />
          </div>
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2.5 text-sm text-subtle">
              <EmployeeAvatar name={employeeName} voice={employeeVoice} status={status} size="sm" />
              <span>{eyebrow}</span>
            </p>
            <h1 className="mt-2 max-w-xl text-balance text-xl font-light leading-snug tracking-tight text-ink sm:text-2xl lg:text-[26px]">
              {stateSentence}
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
