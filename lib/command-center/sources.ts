// Source classification + coverage/freshness/confidence for every Command Center metric. A low-coverage
// derived metric must NEVER look identical to a high-confidence actual — the UI reads these fields to
// render badges + caveats. Nothing derived is ever labeled 'actual'.

export type SourceClass = 'actual' | 'derived_actual' | 'manual' | 'forecast' | 'target' | 'estimate'
export type Confidence = 'high' | 'medium' | 'low' | 'none'

export const SOURCE_LABEL: Record<SourceClass, string> = {
  actual: 'Actual', derived_actual: 'Derived Actual', manual: 'Manual', forecast: 'Forecast', target: 'Target', estimate: 'Estimate',
}

export interface MetricValue<T = number> {
  value: T | null            // null = not yet measurable (Manual / no data) — never faked
  source: SourceClass
  coverage: number           // 0..1 fraction of the population this could be computed for
  confidence: Confidence
  freshnessAt: string | null // ISO timestamp of the underlying data
  reliableFrom?: string | null // historical boundary — before this date the value is derived-only
  caveat?: string
}

export function confidenceFromCoverage(coverage: number): Confidence {
  if (coverage >= 0.8) return 'high'
  if (coverage >= 0.5) return 'medium'
  if (coverage > 0) return 'low'
  return 'none'
}

// Helper to build a metric value with confidence derived from coverage (unless overridden).
export function metric<T = number>(value: T | null, source: SourceClass, opts: Partial<Omit<MetricValue<T>, 'value' | 'source'>> = {}): MetricValue<T> {
  const coverage = opts.coverage ?? (value == null ? 0 : 1)
  return {
    value, source, coverage,
    confidence: opts.confidence ?? (source === 'manual' ? 'none' : confidenceFromCoverage(coverage)),
    freshnessAt: opts.freshnessAt ?? null,
    reliableFrom: opts.reliableFrom ?? null,
    caveat: opts.caveat,
  }
}
