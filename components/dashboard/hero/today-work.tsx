import { CountUp } from '@/components/ui/count-up'
import { KineticNumber } from './kinetic-number'

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
  // Mobile-only hero-metric split: "Recovered" leads, the rest sit on one muted line.
  // Desktop is untouched (md:grid restores the original 2x2).
  const hero = figures.find((f) => f.label === 'Recovered') ?? figures[0]
  const rest = figures.filter((f) => f !== hero)

  return (
    <>
      {/* Mobile (B4): the giant kinetic hero number — label above in muted caps, number in
          dark navy at ~64px, counting up; the other three metrics on one muted line below.
          All four values still render from the same data. */}
      <div className="text-center md:hidden">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{hero.label} this week</span>
        <span className="sx-tabular mt-1.5 block text-[64px] font-semibold leading-none tracking-tight text-ink">
          {hero.value === null ? '—' : <KineticNumber value={hero.value} suffix={hero.suffix} />}
        </span>
        <p className="mt-3 text-[13px] text-muted">
          {rest.map((f, i) => (
            <span key={f.label}>
              {i > 0 && <span className="mx-1.5 text-hairline-strong">·</span>}
              <span className="tabular-nums font-medium text-subtle">
                {f.value === null ? '—' : <CountUp value={f.value} suffix={f.suffix} />}
              </span>{' '}
              {f.label}
            </span>
          ))}
        </p>
      </div>

      {/* Desktop: the original 2x2 grid, pixel-identical. */}
      <div className="hidden grid-cols-2 gap-x-8 gap-y-5 md:grid sm:gap-y-6">
        {figures.map((f) => (
          <div key={f.label} className="flex flex-col items-center lg:items-start">
            <span className="sx-tabular text-4xl font-light leading-none tracking-tight text-ink sm:text-5xl">
              {f.value === null ? '—' : <CountUp value={f.value} suffix={f.suffix} />}
            </span>
            <span className="mt-2 text-xs tracking-wide text-subtle sm:text-sm">{f.label}</span>
          </div>
        ))}
      </div>
    </>
  )
}
