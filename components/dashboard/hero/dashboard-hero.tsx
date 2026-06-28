import Link from 'next/link'
import { Plus } from 'lucide-react'
import { AiOrb } from '@/components/brand/ai-orb'
import { EmployeeAvatar } from '@/components/ai-employees/employee-avatar'
import type { EmployeeStatus } from '@/lib/employee'
import { TodayWork, type WorkFigure } from './today-work'

export type PresenceState = 'ready' | 'working' | 'attention'

export interface DashboardHeroProps {
  employeeName: string
  employeeVoice?: string | null
  presenceState: PresenceState
  stateSentence: string
  businessName: string
  figures: WorkFigure[]
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
}: DashboardHeroProps) {
  const status: EmployeeStatus = presenceState === 'attention' ? 'attention' : 'on_duty'
  const eyebrow = businessName ? `${employeeName} · AI Employee · ${businessName}` : `${employeeName} · AI Employee`

  return (
    <section className="relative flex min-h-[68vh] flex-col justify-center py-10 sm:min-h-[74vh] sx-animate-in">
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

      <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        {/* The living presence */}
        <div className="h-44 w-44 sm:h-52 sm:w-52">
          <AiOrb />
        </div>

        {/* Name + face — the employee's identity, the same headshot shown everywhere */}
        <p className="mt-8 inline-flex items-center gap-2.5 text-sm text-subtle">
          <EmployeeAvatar name={employeeName} voice={employeeVoice} status={status} size="sm" />
          <span>{eyebrow}</span>
        </p>

        {/* The soul — her spoken status, large and thin */}
        <h1 className="mt-4 max-w-2xl text-balance text-2xl font-light leading-[1.18] tracking-tight text-ink sm:text-3xl lg:text-[38px]">
          {stateSentence}
        </h1>

        {/* The work — large, calm figures that dominate the first screen */}
        <div className="mt-12 w-full sm:mt-14">
          <TodayWork figures={figures} />
        </div>
      </div>

      {/* Subtle "scroll for details" affordance */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <span className="text-[11px] uppercase tracking-[0.18em] text-muted/70">Details below</span>
      </div>
    </section>
  )
}
