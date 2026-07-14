'use client'

import { useMemo, useState } from 'react'
import type { MonthForecast } from '@/lib/command-center/types'

type Fmt = 'money' | 'num' | 'pct' | 'months'
interface RowDef { group: string; label: string; fmt: Fmt; get: (m: MonthForecast) => number | null }

const ROWS: RowDef[] = [
  { group: 'Customers', label: 'Beginning customers', fmt: 'num', get: (m) => m.beginCustomers },
  { group: 'Customers', label: 'Direct adds', fmt: 'num', get: (m) => m.directAdds },
  { group: 'Customers', label: 'Affiliate adds', fmt: 'num', get: (m) => m.affiliateAdds },
  { group: 'Customers', label: 'White-label adds', fmt: 'num', get: (m) => m.whiteLabelAdds },
  { group: 'Customers', label: 'Churned', fmt: 'num', get: (m) => m.churnedCustomers },
  { group: 'Customers', label: 'Ending customers', fmt: 'num', get: (m) => m.endCustomers },
  { group: 'Revenue', label: 'Gross MRR', fmt: 'money', get: (m) => m.grossMrrCents },
  { group: 'Revenue', label: 'Expansion MRR', fmt: 'money', get: (m) => m.expansionMrrCents },
  { group: 'Revenue', label: 'Net MRR', fmt: 'money', get: (m) => m.netMrrCents },
  { group: 'Revenue', label: 'ARR', fmt: 'money', get: (m) => m.arrCents },
  { group: 'Costs & Profit', label: 'COGS', fmt: 'money', get: (m) => m.cogsCents },
  { group: 'Costs & Profit', label: 'Gross profit', fmt: 'money', get: (m) => m.grossProfitCents },
  { group: 'Costs & Profit', label: 'Gross margin', fmt: 'pct', get: (m) => m.grossMargin },
  { group: 'Costs & Profit', label: 'Payroll', fmt: 'money', get: (m) => m.payrollCents },
  { group: 'Costs & Profit', label: 'Marketing', fmt: 'money', get: (m) => m.marketingCents },
  { group: 'Costs & Profit', label: 'Operating profit', fmt: 'money', get: (m) => m.operatingProfitCents },
  { group: 'Costs & Profit', label: 'Ending cash', fmt: 'money', get: (m) => m.endingCashCents },
  { group: 'Costs & Profit', label: 'Runway (mo)', fmt: 'months', get: (m) => m.runwayMonths },
  { group: 'KPIs', label: 'ARPU', fmt: 'money', get: (m) => m.arpuCents },
  { group: 'KPIs', label: 'CAC (blended)', fmt: 'money', get: (m) => m.blendedCacCents },
  { group: 'KPIs', label: 'LTV', fmt: 'money', get: (m) => m.ltvCents },
  { group: 'KPIs', label: 'CAC payback (mo)', fmt: 'months', get: (m) => m.cacPaybackMonths },
  { group: 'KPIs', label: 'NRR', fmt: 'pct', get: (m) => m.nrr },
  { group: 'Valuation', label: 'Simulated valuation', fmt: 'money', get: (m) => m.valuationCents },
]
const GROUPS = [...new Set(ROWS.map((r) => r.group))]

const money = (c: number) => (Math.abs(c) >= 100000000 ? `$${(c / 100000000).toFixed(1)}B` : Math.abs(c) >= 100000 ? `$${(c / 100000).toFixed(0)}K` : `$${(c / 100).toFixed(0)}`)
function fmtVal(v: number | null, fmt: Fmt): string {
  if (v == null) return fmt === 'months' ? '∞' : '—'
  if (fmt === 'money') return money(v)
  if (fmt === 'pct') return `${(v * 100).toFixed(0)}%`
  if (fmt === 'months') return v.toFixed(1)
  return Math.round(v).toLocaleString('en-US')
}

export function ForecastTable({ months }: { months: MonthForecast[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (g: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n })

  const csv = useMemo(() => {
    const header = ['Metric', ...months.map((m) => `M${m.month}`)].join(',')
    const lines = ROWS.map((r) => [r.label, ...months.map((m) => { const v = r.get(m); return v == null ? '' : (r.fmt === 'money' ? (v / 100).toFixed(2) : r.fmt === 'pct' ? (v * 100).toFixed(2) : String(v)) })].join(','))
    return [header, ...lines].join('\n')
  }, [months])
  const download = () => {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'forecast.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button onClick={download} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink">Export CSV</button>
        <span className="text-xs text-subtle">{months.length} months · scroll horizontally · every value is <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-700">Forecast</span></span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-hairline-strong">
        <table className="min-w-full text-xs">
          <thead className="bg-sunken text-subtle">
            <tr>
              <th className="sticky left-0 z-10 bg-sunken px-3 py-2 text-left font-medium">Metric</th>
              {months.map((m) => <th key={m.month} className="px-2 py-2 text-right font-medium whitespace-nowrap">M{m.month}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {GROUPS.map((g) => (
              <>
                <tr key={g} className="bg-white/60"><td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-semibold text-ink" colSpan={1}><button onClick={() => toggle(g)} className="underline">{collapsed.has(g) ? '▸' : '▾'} {g}</button></td>{months.map((m) => <td key={m.month} className="px-2 py-1.5" />)}</tr>
                {!collapsed.has(g) && ROWS.filter((r) => r.group === g).map((r) => (
                  <tr key={r.label}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-subtle whitespace-nowrap">{r.label}</td>
                    {months.map((m) => <td key={m.month} className="px-2 py-1.5 text-right tabular-nums text-ink whitespace-nowrap">{fmtVal(r.get(m), r.fmt)}</td>)}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
