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
    <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:gap-y-6">
      {figures.map((f) => (
        <div key={f.label} className="flex flex-col items-center lg:items-start">
          <span className="sx-tabular text-4xl font-light leading-none tracking-tight text-ink sm:text-5xl">
            {f.value === null ? '—' : <CountUp value={f.value} suffix={f.suffix} />}
          </span>
          <span className="mt-2 text-xs tracking-wide text-subtle sm:text-sm">{f.label}</span>
        </div>
      ))}
    </div>
  )
}
