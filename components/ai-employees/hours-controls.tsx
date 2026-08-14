'use client'

import { Switch } from '@/components/ui/switch'
import { DayHours } from '@/lib/appointments'

// TimeSelect, WeeklyHoursGrid and the TIME_SLOTS they read, moved here VERBATIM from
// ai-employee-edit-client.tsx.
//
// Left in place during commit 0, which was a pure lift of state and handlers. Commit 2 needs them on
// the /v2 surface, commit 3 needs them again, and the old editor still renders them — so they move
// once, shared, rather than being copied to whichever screen needs them next.
//
// Both are presentation: a value in, a callback out. Neither holds state or knows where its hours are
// stored, which is why the same pair serves Business Hours on one screen and Appointment Availability
// on another without either learning about the other.

const TIME_SLOTS: { value: string; label: string }[] = (() => {
  const out: { value: string; label: string }[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const value = `${h}:${String(m).padStart(2, '0')}`        // e.g. "9:00", "17:30"
      const period = h < 12 ? 'AM' : 'PM'
      const h12 = h % 12 === 0 ? 12 : h % 12
      out.push({ value, label: `${h12}:${String(m).padStart(2, '0')} ${period}` })
    }
  }
  return out
})()
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export const DAY_LABELS: Record<typeof DAYS[number], string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

export function TimeSelect({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-11 min-w-[110px] flex-1 rounded-xl border border-hairline-strong bg-white px-2.5 text-sm text-ink outline-none transition-shadow duration-200 focus:border-ink/15 focus:shadow-[0_0_0_4px_rgba(26,31,54,0.04)] sm:h-10 sm:min-w-0 sm:flex-none"
    >
      {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  )
}
export function WeeklyHoursGrid({ hours, onUpdate }: {
  hours: Record<string, DayHours>
  onUpdate: (day: string, next: Partial<DayHours>) => void
}) {
  return (
    <div className="mt-3 rounded-xl border border-hairline divide-y divide-hairline">
      {DAYS.map(day => {
        const { isOpen, open, close } = hours[day]
        return (
          <div key={day} className="flex flex-col gap-2 px-3 sm:px-4 py-3 min-h-[52px] sm:flex-row sm:items-center sm:gap-3 sm:min-h-0">
            <div className="flex items-center gap-2.5 w-28 sm:w-36 shrink-0">
              <Switch checked={isOpen} onCheckedChange={v => onUpdate(day, { isOpen: v })} aria-label={`${DAY_LABELS[day]} open`} />
              <span className="text-sm font-medium text-ink">{DAY_LABELS[day]}</span>
            </div>
            {isOpen ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <TimeSelect value={open} onChange={v => onUpdate(day, { open: v })} ariaLabel={`${DAY_LABELS[day]} opening time`} />
                <span className="text-xs text-muted">to</span>
                <TimeSelect value={close} onChange={v => onUpdate(day, { close: v })} ariaLabel={`${DAY_LABELS[day]} closing time`} />
              </div>
            ) : (
              <span className="flex-1 text-sm text-muted italic">Closed</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
