import { cn } from '@/lib/utils'
import { voiceAvatar, STATUS_META, type EmployeeStatus } from '@/lib/employee'

type Size = 'xs' | 'sm' | 'md' | 'lg'

const SIZES: Record<Size, { box: string; text: string; dot: string; ring: string }> = {
  xs: { box: 'h-7 w-7', text: 'text-[11px]', dot: 'h-2.5 w-2.5 -bottom-0 -right-0', ring: 'border' },
  sm: { box: 'h-9 w-9', text: 'text-xs', dot: 'h-3 w-3 -bottom-0.5 -right-0.5', ring: 'border-2' },
  md: { box: 'h-12 w-12', text: 'text-lg', dot: 'h-3.5 w-3.5 -bottom-0.5 -right-0.5', ring: 'border-2' },
  lg: { box: 'h-16 w-16', text: 'text-2xl', dot: 'h-4 w-4 -bottom-0.5 -right-0.5', ring: 'border-2' },
}

/**
 * The AI employee's face — the official headshot of its chosen voice, with a soft
 * presence dot. The single identity primitive: use it anywhere an employee appears
 * (list, editor, dashboard, Ask Amy, activity feed, notifications) so the same
 * employee always shows the same face + status. No hooks → server/client safe.
 */
export function EmployeeAvatar({
  name,
  voice,
  status = 'on_duty',
  size = 'md',
  showStatus = true,
  className,
}: {
  name: string
  voice?: string | null
  status?: EmployeeStatus
  size?: Size
  showStatus?: boolean
  className?: string
}) {
  const src = voiceAvatar(voice)
  const s = SIZES[size]
  const st = STATUS_META[status]
  return (
    <span className={cn('relative inline-flex flex-shrink-0', className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className={cn('rounded-full object-cover ring-1 ring-hairline', s.box)} />
      ) : (
        <span className={cn('rounded-full bg-gradient-to-br from-sunken to-hairline ring-1 ring-hairline flex items-center justify-center text-ink font-light', s.box, s.text)}>
          {name?.[0]?.toUpperCase() || '?'}
        </span>
      )}
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
