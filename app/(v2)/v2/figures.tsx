import type { RudiSegment } from './rudi-line'
import Link from 'next/link'

// THE FIGURES BOARD — the fourth shared component, and the first one that is about NUMBERS.
//
// DetailPage's facts are label/value pairs on hairlines: right for a record, where every field weighs
// the same and you read down looking for one. Wrong for a screen whose whole job is to report a
// result, where one figure matters and the rest support it. A board reads in one glance; a table is
// read line by line.
//
// So this is not DetailPage with different CSS. It has a hero — one number, set large, the only place
// the gradient appears — and everything else is subordinate to it by size rather than by position.
//
// Server component. Nothing here is interactive.

export interface Figure {
  label: string
  /** Null renders an em dash. A figure that does not exist is never a zero. */
  value: string | null
  /** Below the number, when it needs one. */
  note?: string | null
}

export interface Share {
  id: string
  label: string
  /** The count itself, shown as the figure. */
  value: number
  /** 0–1. Drives the bar's width, so the bar and the number cannot disagree. */
  fraction: number
}

export interface FiguresBoardProps {
  title: string
  /** The window these numbers cover, in mono above the title. */
  eyebrow?: string | null
  line: RudiSegment[]
  /** The one number the screen exists to report. Absent when there is nothing to report. */
  hero?: {
    label: string
    value: string | null
    note?: string | null
    /** Draws the highlighter behind the figure. Same rule as the sheet's tiles: never when the figure
     *  is zero or unavailable, because the green marks something real or it marks nothing. */
    marked?: boolean
  }
  figures: Figure[]
  shares?: { title: string; rows: Share[]; empty: string }
  backHref: string
  backLabel: string
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
)

export function FiguresBoard({ title, eyebrow, line, hero, figures, shares, backHref, backLabel }: FiguresBoardProps) {
  return (
    <div className="v2-page">
      <header className="v2-phd">
        <Link href={backHref} className="v2-bk" aria-label={backLabel}><Chevron /></Link>
        <h2>{title}</h2>
      </header>

      <div className="v2-pbody" data-scroll>
        {eyebrow && <p className="v2-eyebrow">{eyebrow}</p>}

        <p className="v2-lin">
          {line.map((s, i) => (s.accent ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
        </p>

        {hero && (
          <section className="v2-hero-fig">
            <p className="v2-figlab">{hero.label}</p>
            {/* THE one gradient on this screen. Everything else is ink. */}
            <span className="v2-fignum-wrap">
              {hero.marked && hero.value && <em className="v2-marker" data-hero aria-hidden />}
              <p className="v2-figbig">{hero.value ?? '—'}</p>
            </span>
            {hero.note && <p className="v2-fignote">{hero.note}</p>}
          </section>
        )}

        {figures.length > 0 && (
          <section className="v2-figgrid">
            {figures.map((f) => (
              <div key={f.label}>
                {/* Micro-label above the number, mono and uppercase — the number is what you read. */}
                <p className="v2-figlab">{f.label}</p>
                <p className="v2-fignum">{f.value ?? '—'}</p>
                {f.note && <p className="v2-fignote">{f.note}</p>}
              </div>
            ))}
          </section>
        )}

        {/* Same rule as DetailPage: no heading over a void. A breakdown with nothing to break down
            and nothing to say about it draws nothing. */}
        {shares && (shares.rows.length > 0 || shares.empty) && (
          <section className="v2-shares">
            <h3>{shares.title}</h3>
            {shares.rows.length === 0 ? (
              <p className="v2-pnone">{shares.empty}</p>
            ) : (
              shares.rows.map((r) => (
                <div key={r.id} className="v2-share">
                  <div className="v2-sharehead">
                    <span>{r.label}</span>
                    <em>{r.value}</em>
                  </div>
                  {/* The width IS the share, so the bar and the figure beside it cannot disagree. */}
                  <div className="v2-sharebar"><i style={{ width: `${Math.max(2, Math.round(r.fraction * 100))}%` }} /></div>
                </div>
              ))
            )}
          </section>
        )}
      </div>
    </div>
  )
}
