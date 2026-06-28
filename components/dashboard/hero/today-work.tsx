import { CountUp } from '@/components/ui/count-up'

export interface WorkFigure {
  value: number | null
  suffix?: string
  label: string
}

/**
 * Today's work — large, Apple-style figures that DOMINATE the first viewport: the
 * day's story in numbers (handled, booked, recovered, coverage). They count up on
 * load — the proof of work animating into place. Null renders a calm em-dash.
 */
export function TodayWork({ figures }: { figures: WorkFigure[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 sm:gap-x-8">
      {figures.map((f) => (
        <div key={f.label} className="flex flex-col items-center">
          <span className="sx-tabular text-5xl font-light leading-none tracking-tight text-ink sm:text-6xl">
            {f.value === null ? '—' : <CountUp value={f.value} suffix={f.suffix} />}
          </span>
          <span className="mt-3.5 text-xs tracking-wide text-subtle sm:text-sm">{f.label}</span>
        </div>
      ))}
    </div>
  )
}
