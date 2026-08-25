'use client'

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
  // The form language's select: a rule under it, not a box around it. Wrapped in .v2-sel so the
  // chevron is drawn rather than left to the platform, which renders a boxed control on macOS.
  return (
    <span className="v2-sel" style={{ flex: 1, minWidth: 0 }}>
      <select className="v2-finput" aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)}>
        {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </span>
  )
}
export function WeeklyHoursGrid({ hours, onUpdate }: {
  hours: Record<string, DayHours>
  onUpdate: (day: string, next: Partial<DayHours>) => void
}) {
  // SEVEN ROWS, ONE HAIRLINE EACH — inside a section that is already a bordered card, so no second
  // border of its own. A closed day says "Closed" where its times would be rather than collapsing,
  // so the seven rows stay the same shape whatever the week looks like.
  return (
    <div>
      {DAYS.map(day => {
        const { isOpen, open, close } = hours[day]
        return (
          <div key={day} className="v2-hrow">
            <button
              type="button" role="switch" aria-checked={isOpen} aria-label={`${DAY_LABELS[day]} open`}
              className="v2-toggle" data-on={isOpen || undefined}
              onClick={() => onUpdate(day, { isOpen: !isOpen })}
            ><i /></button>
            <span className="v2-hday">{DAY_LABELS[day]}</span>
            {isOpen ? (
              <span className="v2-htimes">
                <TimeSelect value={open} onChange={v => onUpdate(day, { open: v })} ariaLabel={`${DAY_LABELS[day]} opening time`} />
                <em>to</em>
                <TimeSelect value={close} onChange={v => onUpdate(day, { close: v })} ariaLabel={`${DAY_LABELS[day]} closing time`} />
              </span>
            ) : (
              <span className="v2-hclosed">Closed</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
