import { cn } from '@/lib/utils'
import { STATUS_META, type EmployeeStatus } from '@/lib/employee'
import { RobotAvatar } from '@/components/brand/robot-avatar'

type Size = 'xs' | 'sm' | 'md' | 'lg'

const SIZES: Record<Size, { px: number; dot: string; ring: string }> = {
  xs: { px: 28, dot: 'h-2.5 w-2.5 -bottom-0 -right-0', ring: 'border' },
  sm: { px: 36, dot: 'h-3 w-3 -bottom-0.5 -right-0.5', ring: 'border-2' },
  md: { px: 48, dot: 'h-3.5 w-3.5 -bottom-0.5 -right-0.5', ring: 'border-2' },
  lg: { px: 64, dot: 'h-4 w-4 -bottom-0.5 -right-0.5', ring: 'border-2' },
}

/**
 * THE AI EMPLOYEE'S FACE — THE ROBOT, NOT THE VOICE'S HEADSHOT.
 *
 * This used to render `voiceAvatar(voice)`: a stock photograph of whichever TTS voice the tenant
 * happened to pick. Two things were wrong with that, and they are the same thing twice.
 *
 * A voice is a setting. Change it from Aura to Luna and the employee's face changed — the same
 * employee, the same conversations, a different person in every list. Identity that moves when a
 * dropdown moves is not identity.
 *
 * And it broke the one-face rule the whole product now runs on: the dashboard hero, the inbox rows
 * and Ask Amy all show the robot, and this showed a human. A customer's AI employee looked like one
 * being on one screen and a different being on the next. /inbox lost its stock headshots for exactly
 * this reason; this is the same fix arriving at the place the face is actually configured.
 *
 * `voice` stays in the signature because every call site passes it and because the presence dot below
 * is unchanged — but nothing reads it any more. `RobotAvatar` crops the dome out of the persona's own
 * still using the measurement in lib/persona, so a new asset needs no change here.
 *
 * The single identity primitive: use it anywhere an employee appears (list, editor, dashboard, Ask
 * Amy, activity feed, notifications) so the same employee always shows the same face + status. No
 * hooks → server/client safe.
 */
export function EmployeeAvatar({
  name,
  status = 'on_duty',
  size = 'md',
  showStatus = true,
  className,
}: {
  name: string
  /** Accepted and ignored. Kept in the signature so the call sites need no change and so the fact
   *  that a voice no longer decides the face is legible from the type. Deliberately not destructured. */
  voice?: string | null
  status?: EmployeeStatus
  size?: Size
  showStatus?: boolean
  className?: string
}) {
  const s = SIZES[size]
  const st = STATUS_META[status]
  return (
    <span className={cn('relative inline-flex flex-shrink-0', className)} title={name}>
      <RobotAvatar size={s.px} />
      {showStatus && (
        <span
          className={cn('absolute rounded-full border-white', s.dot, s.ring, st.dot)}
          title={st.label}
          aria-label={st.label}
        >
          {st.pulse && <span className={cn('absolute inset-0 rounded-full animate-ping opacity-60', st.dot)} />}
        </span>
      )}
    </span>
  )
}
