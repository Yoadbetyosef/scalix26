'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { StatCard, Panel, EmptyRow, money } from '@/components/partner/ui'
import { Download, CheckCircle2, CreditCard } from 'lucide-react'

function PayoutSetup() {
  const [status, setStatus] = useState<{ connected: boolean; payoutsEnabled: boolean; onboardingComplete: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetch('/api/partner/connect').then((r) => r.json()).then(setStatus) }, [])

  async function connect() {
    setBusy(true)
    const res = await fetch('/api/partner/connect', { method: 'POST' })
    const j = await res.json(); setBusy(false)
    if (!res.ok) return toast.error(j.error || 'Failed')
    if (j.url) window.location.href = j.url
  }

  if (!status) return null
  if (status.payoutsEnabled) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        <CheckCircle2 className="h-5 w-5" /> Payouts are set up — approved commissions are transferred automatically.
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-accent-strong" />
        <div><div className="font-medium text-ink">Set up payouts</div><div className="text-sm text-subtle">Connect your bank to receive commissions automatically.</div></div>
      </div>
      <button onClick={connect} disabled={busy} className="h-10 rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Opening…' : status.onboardingComplete ? 'Finish setup' : 'Set up payouts'}</button>
    </div>
  )
}

interface Entry { id: string; entry_type: string; amount_cents: number; currency: string; status: string; period_start: string | null; period_end: string | null; created_at: string }
interface Payout { id: string; amount_cents: number; currency: string; status: string; period_start: string | null; period_end: string | null; statement_url: string | null; paid_at: string | null; created_at: string }
interface Summary { pending_cents: number; approved_cents: number; paid_cents: number; lifetime_cents: number; estimated_next_payout_cents: number; projected_monthly_cents: number; projected_annual_cents: number; average_commission_cents: number; mrr_created_cents: number }
interface Data { summary: Summary; entries: Entry[]; payouts: Payout[] }

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700', approved: 'bg-blue-50 text-blue-700', paid: 'bg-green-50 text-green-700',
  void: 'bg-gray-100 text-gray-500', failed: 'bg-red-50 text-red-600', processing: 'bg-sky-50 text-sky-700', draft: 'bg-gray-100 text-gray-500',
}

export function CommissionsView() {
  const [data, setData] = useState<Data | null>(null)
  useEffect(() => { fetch('/api/partner/commissions').then((r) => r.json()).then(setData) }, [])

  function exportCsv() {
    if (!data) return
    const rows = [['Date', 'Type', 'Amount', 'Currency', 'Status', 'Period start', 'Period end']]
    for (const e of data.entries) rows.push([new Date(e.created_at).toISOString().slice(0, 10), e.entry_type, (e.amount_cents / 100).toFixed(2), e.currency, e.status, e.period_start || '', e.period_end || ''])
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'scalix-commissions.csv'; a.click()
  }

  if (!data) return <EmptyRow>Loading…</EmptyRow>
  const s = data.summary

  return (
    <div className="space-y-6">
      <PayoutSetup />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pending" value={money(s.pending_cents)} hint="Not yet approved" />
        <StatCard label="Approved" value={money(s.approved_cents)} hint="Awaiting payout" accent />
        <StatCard label="Paid" value={money(s.paid_cents)} hint="Received" />
        <StatCard label="Lifetime" value={money(s.lifetime_cents)} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Est. Next Payout" value={money(s.estimated_next_payout_cents)} hint="Pending + approved" />
        <StatCard label="Projected / mo" value={money(s.projected_monthly_cents)} hint="Recurring you generate" />
        <StatCard label="Projected / yr" value={money(s.projected_annual_cents)} hint="At current MRR" />
        <StatCard label="Avg. Commission" value={money(s.average_commission_cents)} hint="Per paid entry" />
      </div>

      <Panel title="Ledger" action={<button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-subtle hover:text-ink"><Download className="h-3.5 w-3.5" /> Export CSV</button>}>
        {data.entries.length === 0 ? <EmptyRow>No commission yet. Refer a customer who converts to paid and it appears here.</EmptyRow> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Period</th><th className="py-2 pr-3 font-medium text-right">Amount</th><th className="py-2 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className="border-b border-hairline/60">
                    <td className="py-2 pr-3 text-subtle">{new Date(e.created_at).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 capitalize text-ink">{e.entry_type.replace('_', ' ')}</td>
                    <td className="py-2 pr-3 text-xs text-muted">{e.period_start ? `${e.period_start} → ${e.period_end}` : '—'}</td>
                    <td className={`py-2 pr-3 text-right font-medium ${e.amount_cents < 0 ? 'text-red-600' : 'text-ink'}`}>{money(e.amount_cents, e.currency)}</td>
                    <td className="py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.status] || ''}`}>{e.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Payouts">
        {data.payouts.length === 0 ? <EmptyRow>No payouts yet.</EmptyRow> : (
          <div className="divide-y divide-hairline">
            {data.payouts.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink">{money(p.amount_cents, p.currency)}</div>
                  <div className="text-xs text-muted">{p.period_start ? `${p.period_start} → ${p.period_end}` : new Date(p.created_at).toLocaleDateString()}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status] || ''}`}>{p.status}</span>
                {p.statement_url && <a href={p.statement_url} className="text-accent-strong hover:underline"><Download className="h-4 w-4" /></a>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
