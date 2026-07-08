'use client'

import { useEffect, useState } from 'react'
import { Panel, EmptyRow, money } from '@/components/partner/ui'

interface Data {
  funnel: { clicks: number; signups: number; trials: number; paid: number }
  months: { month: string; cents: number }[]
  topLinks: { label: string; clicks: number; signups: number; paid: number }[]
}

export function AnalyticsView() {
  const [data, setData] = useState<Data | null>(null)
  useEffect(() => { fetch('/api/partner/analytics').then((r) => r.json()).then(setData) }, [])
  if (!data) return <EmptyRow>Loading…</EmptyRow>

  const f = data.funnel
  const stages = [
    { label: 'Clicks', value: f.clicks },
    { label: 'Signups', value: f.signups },
    { label: 'Trials', value: f.trials },
    { label: 'Paid', value: f.paid },
  ]
  const maxStage = Math.max(...stages.map((s) => s.value), 1)
  const maxMonth = Math.max(...data.months.map((m) => m.cents), 1)

  return (
    <div className="space-y-6">
      <Panel title="Conversion funnel">
        <div className="space-y-2">
          {stages.map((s, i) => (
            <div key={s.label} className="flex items-center gap-3">
              <div className="w-20 text-sm text-subtle">{s.label}</div>
              <div className="h-7 flex-1 overflow-hidden rounded-lg bg-sunken">
                <div className="flex h-full items-center justify-end rounded-lg bg-accent/80 px-2 text-xs font-medium text-white" style={{ width: `${Math.max((s.value / maxStage) * 100, s.value ? 8 : 0)}%` }}>{s.value}</div>
              </div>
              {i > 0 && <div className="w-14 text-right text-xs text-muted">{stages[i - 1].value ? Math.round((s.value / stages[i - 1].value) * 100) : 0}%</div>}
              {i === 0 && <div className="w-14" />}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Commission earned (last 12 months)">
        <div className="flex h-40 items-end gap-1.5">
          {data.months.map((m) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-t bg-accent/70" style={{ height: `${(m.cents / maxMonth) * 100}%`, minHeight: m.cents ? 3 : 0 }} title={money(m.cents)} />
              <div className="text-[9px] text-muted">{m.month.slice(5)}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Top links">
        {data.topLinks.length === 0 ? <EmptyRow>No link data yet.</EmptyRow> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Link</th><th className="py-2 pr-3 font-medium text-right">Clicks</th>
                <th className="py-2 pr-3 font-medium text-right">Signups</th><th className="py-2 font-medium text-right">Paid</th>
              </tr></thead>
              <tbody>
                {data.topLinks.map((l, i) => (
                  <tr key={i} className="border-b border-hairline/60">
                    <td className="py-2 pr-3 text-ink">{l.label}</td>
                    <td className="py-2 pr-3 text-right text-subtle">{l.clicks}</td>
                    <td className="py-2 pr-3 text-right text-subtle">{l.signups}</td>
                    <td className="py-2 text-right font-medium text-ink">{l.paid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
