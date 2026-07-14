import type { MetricValue, SourceClass, Confidence } from '@/lib/command-center/sources'
import { SOURCE_LABEL } from '@/lib/command-center/sources'

// Source-aware metric rendering: the badge + confidence + coverage + caveat make a low-coverage derived
// value visually distinct from a high-confidence actual. Server component.

const SRC_TONE: Record<SourceClass, string> = {
  actual: 'bg-emerald-100 text-emerald-700', derived_actual: 'bg-sky-100 text-sky-700', manual: 'bg-gray-100 text-gray-600',
  forecast: 'bg-violet-100 text-violet-700', target: 'bg-amber-100 text-amber-700', estimate: 'bg-orange-100 text-orange-700',
}
const CONF_TONE: Record<Confidence, string> = { high: 'text-emerald-600', medium: 'text-amber-600', low: 'text-red-600', none: 'text-subtle' }

export function SourceBadge({ m }: { m: MetricValue }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SRC_TONE[m.source]}`}>{SOURCE_LABEL[m.source]}</span>
}

export function MetricStat({ label, m, format }: { label: string; m: MetricValue; format: (v: number) => string }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${m.confidence === 'low' || m.confidence === 'none' ? 'border-dashed border-hairline-strong' : 'border-hairline-strong'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</span>
        <SourceBadge m={m} />
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{m.value == null ? '—' : format(m.value)}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]">
        <span className={CONF_TONE[m.confidence]}>{m.confidence === 'none' ? 'no data yet' : `${m.confidence} confidence`}</span>
        {m.coverage > 0 && m.coverage < 1 && <span className="text-subtle">· {Math.round(m.coverage * 100)}% coverage</span>}
        {m.freshnessAt && <span className="text-subtle">· {new Date(m.freshnessAt).toLocaleDateString()}</span>}
      </div>
      {m.caveat && <div className="mt-1 text-[10px] leading-tight text-subtle">{m.caveat}</div>}
    </div>
  )
}

const BUCKET_TONE = { healthy: 'text-emerald-600', watch: 'text-amber-600', at_risk: 'text-orange-600', critical: 'text-red-600' } as const
export function HealthPill({ bucket }: { bucket: 'healthy' | 'watch' | 'at_risk' | 'critical' }) {
  return <span className={`text-xs font-semibold capitalize ${BUCKET_TONE[bucket]}`}>{bucket.replace('_', ' ')}</span>
}
