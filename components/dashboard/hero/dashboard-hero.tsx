import Link from 'next/link'
import { Plus } from 'lucide-react'
import { AiOrb } from '@/components/brand/ai-orb'
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
}: DashboardHeroProps) {
  const status: EmployeeStatus = presenceState === 'attention' ? 'attention' : 'on_duty'
  const eyebrow = businessName ? `${employeeName} · AI Employee · ${businessName}` : `${employeeName} · AI Employee`

  return (
    <section className="relative py-6 sm:py-8 sx-animate-in">
      {/* The one preserved action — a quiet whisper in the corner */}
      <div className="absolute right-0 top-0 z-10">
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
        {/* Identity — the AI presence + who's on duty (compact) */}
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
          <div className="h-24 w-24 flex-shrink-0 sm:h-28 sm:w-28">
            <AiOrb />
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
        <div className="mt-7 grid gap-x-10 gap-y-7 sm:mt-8 lg:grid-cols-2 lg:items-center">
          <div className="order-2 lg:order-1">
            <AskAmy briefing={briefing} />
          </div>
          <div className="order-1 lg:order-2 lg:border-l lg:border-hairline lg:pl-10">
            <TodayWork figures={figures} />
          </div>
        </div>
      </div>
    </section>
  )
}
