'use client'

import type { ReactNode } from 'react'

/**
 * THE TOOLTIP EVERY CHART SHARES.
 *
 * Recharts' default is a white box with a border, a drop shadow and the browser's default face —
 * three vocabularies this design does not use. This is the popover: paper, one hairline, no shadow,
 * a mono micro-label over a tabular figure, and a dot in the series' own hue so a multi-series
 * tooltip says which line you are reading without a second legend.
 *
 * Presentation only. It takes what recharts hands it and renders; nothing here knows what the
 * numbers mean, which is why the same component serves a line, a bar and a pie.
 */

export interface TipEntry {
  name?: string | number
  value?: number | string
  color?: string
  /** Recharts nests the datum here for pies; used only to recover a per-slice colour. */
  payload?: { color?: string; fill?: string; [k: string]: unknown }
}

export function ChartTip({
  active,
  payload,
  label,
  /** Overrides the label recharts derives — a pie has no axis, so its slice name is the label. */
  labelFrom,
  format = (v) => String(v),
}: {
  active?: boolean
  payload?: TipEntry[]
  label?: ReactNode
  labelFrom?: (e: TipEntry) => ReactNode
  format?: (v: number | string) => string
}) {
  if (!active || !payload?.length) return null
  const head = labelFrom ? labelFrom(payload[0]) : label
  return (
    <div className="v2-ctip">
      {head != null && head !== '' && <b>{head}</b>}
      {payload.map((e, i) => (
        <span key={i} style={{ ['--ghue' as string]: e.color || e.payload?.fill || e.payload?.color || 'var(--v2-t1)' }}>
          <i />
          {format(e.value ?? 0)}
        </span>
      ))}
    </div>
  )
}

/**
 * The signature gradient, as an SVG def a series can reference by id.
 *
 * A CSS gradient cannot paint an SVG stroke, so the one place the design's gradient belongs on this
 * screen — the single line that is the screen's subject — needs a real `<linearGradient>`. Drop it
 * inside the chart and stroke with `url(#id)`.
 */
export function ChartGradient({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--v2-t1)" />
        <stop offset="60%" stopColor="var(--v2-t3)" />
        <stop offset="100%" stopColor="var(--v2-t4)" />
      </linearGradient>
    </defs>
  )
}
