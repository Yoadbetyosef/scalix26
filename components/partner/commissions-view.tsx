'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { StatCard, Panel, EmptyRow, money } from '@/components/partner/ui'
import {
  Download, CheckCircle2, CreditCard, ArrowRight, Link2, MonitorPlay, ShieldCheck, Wallet, TrendingUp,
  Info, X, Mail, Rocket, Clock,
} from 'lucide-react'

const PAYOUT_SUPPORT_EMAIL = 'partners@scalix26.com'

interface ConnectStatus { configured: boolean; connected: boolean; payoutsEnabled: boolean; onboardingComplete: boolean }

// ── Payout banner ─────────────────────────────────────────────────────────
function PayoutBanner() {
  const [s, setS] = useState<ConnectStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [showManual, setShowManual] = useState(false)
  useEffect(() => { fetch('/api/partner/connect').then((r) => r.json()).then(setS).catch(() => setS({ configured: false, connected: false, payoutsEnabled: false, onboardingComplete: false })) }, [])

  async function setup() {
    setBusy(true)
    try {
      const res = await fetch('/api/partner/connect', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (res.status === 403) { toast.error(j.error || 'Only the owner or finance role can set up payouts.'); return }
      if (j.configured === false) { setShowManual(true); return }
      if (j.url) { window.location.href = j.url; return }
      setShowManual(true)
    } catch {
      setShowManual(true)
    } finally { setBusy(false) }
  }

  const payoutsActive = s?.payoutsEnabled
  const pendingSetup = s?.configured && s?.onboardingComplete && !s?.payoutsEnabled
  const canSetup = s?.configured && !s?.onboardingComplete && !s?.payoutsEnabled
  const manualMode = s && !s.configured

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-hairline bg-gradient-to-br from-accent/[0.07] to-transparent shadow-e1">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-strong"><Wallet className="h-5 w-5" /></span>
            <div>
              <div className="text-base font-semibold text-ink">Get paid for every customer you bring.</div>
              <p className="mt-0.5 max-w-md text-sm text-subtle">Connect payouts when available, or track manual payouts here until Stripe Connect is enabled.</p>
            </div>
          </div>
          <div className="shrink-0">
            {!s ? (
              <div className="h-10 w-40 animate-pulse rounded-lg bg-sunken" />
            ) : payoutsActive ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-800"><CheckCircle2 className="h-4 w-4" /> Payouts active</span>
            ) : pendingSetup ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700"><Clock className="h-4 w-4" /> Payouts pending setup</span>
            ) : canSetup ? (
              <button onClick={setup} disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50"><CreditCard className="h-4 w-4" /> {busy ? 'Opening…' : 'Set up payouts'}</button>
            ) : (
              <button onClick={() => setShowManual(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface px-4 text-sm font-medium text-subtle hover:text-ink"><Info className="h-4 w-4" /> Manual payout mode</button>
            )}
          </div>
        </div>
        {manualMode && (
          <div className="border-t border-hairline bg-surface/60 px-5 py-2.5 text-xs text-muted">
            Automatic payouts aren&apos;t enabled yet — your commissions are fully tracked and paid manually in the meantime.
          </div>
        )}
      </div>

      {showManual && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setShowManual(false)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
              <div className="font-semibold text-ink">How payouts work</div>
              <button onClick={() => setShowManual(false)} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm leading-relaxed text-subtle">Automatic payouts are not available yet. Your commissions are still tracked in full. Scalix26 will process payouts manually until automatic payouts are enabled.</p>
              <div className="space-y-2.5 rounded-xl border border-hairline bg-canvas p-3.5 text-sm">
                <div className="flex items-center justify-between gap-3"><span className="text-muted">Payout status</span><span className="inline-flex items-center gap-1.5 font-medium text-ink"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Manual</span></div>
                <div className="flex items-center justify-between gap-3"><span className="text-muted">Support</span><a href={`mailto:${PAYOUT_SUPPORT_EMAIL}`} className="inline-flex items-center gap-1.5 font-medium text-accent-strong hover:underline"><Mail className="h-3.5 w-3.5" /> {PAYOUT_SUPPORT_EMAIL}</a></div>
                <div className="flex items-start justify-between gap-3"><span className="text-muted">Next step</span><span className="max-w-[62%] text-right font-medium text-ink">Keep referring — we&apos;ll reach out to arrange payment for approved commissions.</span></div>
              </div>
              <button onClick={() => setShowManual(false)} className="h-10 w-full rounded-lg bg-ink text-sm font-medium text-white">Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────
interface Entry { id: string; entry_type: string; amount_cents: number; currency: string; status: string; source: string; customer_name: string | null; plan_name: string | null; period_start: string | null; period_end: string | null; created_at: string; payout_date: string | null }
interface Payout { id: string; amount_cents: number; currency: string; status: string; period_start: string | null; period_end: string | null; statement_url: string | null; paid_at: string | null; created_at: string }
interface Forecast { monthly_recurring_cents: number; projected_annual_cents: number; active_customers: number; avg_per_customer_cents: number | null; customers_to_1000: number | null; customers_to_5000: number | null; current_rate_pct: number | null; next_tier: { at_customers: number; pct: number } | null }
interface Summary { pending_cents: number; approved_cents: number; paid_cents: number; lifetime_cents: number; estimated_next_payout_cents: number; monthly_recurring_income_cents: number; projected_annual_cents: number; portfolio_value_cents: number; expansion_cents: number; churn_cents: number; active_customers: number; average_commission_cents: number }
interface Data { summary: Summary; forecast: Forecast; entries: Entry[]; payouts: Payout[] }

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700', approved: 'bg-blue-50 text-blue-700', paid: 'bg-green-50 text-green-700',
  void: 'bg-gray-100 text-gray-500', failed: 'bg-red-50 text-red-600', processing: 'bg-sky-50 text-sky-700', draft: 'bg-gray-100 text-gray-500',
}
const EVENT_LABEL: Record<string, string> = { recurring: 'Recurring', one_time: 'New customer', bonus: 'Bonus', expansion: 'Expansion', clawback: 'Refund / clawback', adjustment: 'Adjustment' }
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// ── Commission engine (forecast) ─────────────────────────────────────────
function CommissionEngine({ f }: { f: Forecast }) {
  const hasData = f.monthly_recurring_cents > 0 || f.active_customers > 0
  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Rocket className="h-4 w-4 text-accent-strong" /> Your commission engine</span>}>
      {!hasData ? (
        <div className="rounded-xl border border-dashed border-hairline-strong bg-canvas p-6 text-center">
          <p className="mx-auto max-w-md text-sm text-subtle">Refer your first paying customer to project your path to <span className="font-medium text-ink">$1,000/mo</span> and <span className="font-medium text-ink">$5,000/mo</span>. Recurring commission compounds every month a customer stays active.</p>
          {f.current_rate_pct != null && <p className="mt-2 text-xs text-muted">Your current commission rate: <span className="font-medium text-ink">{f.current_rate_pct}%</span> recurring.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-accent/25 bg-accent/[0.05] p-3.5"><div className="text-[11px] font-medium uppercase tracking-wide text-muted">Monthly recurring</div><div className="mt-1 text-xl font-semibold tabular-nums text-accent-strong">{money(f.monthly_recurring_cents)}</div></div>
            <div className="rounded-xl border border-hairline bg-canvas p-3.5"><div className="text-[11px] font-medium uppercase tracking-wide text-muted">Projected annual</div><div className="mt-1 text-xl font-semibold tabular-nums text-ink">{money(f.projected_annual_cents)}</div></div>
            <div className="rounded-xl border border-hairline bg-canvas p-3.5"><div className="text-[11px] font-medium uppercase tracking-wide text-muted">Commission rate</div><div className="mt-1 text-xl font-semibold tabular-nums text-ink">{f.current_rate_pct != null ? `${f.current_rate_pct}%` : '—'}</div></div>
            <div className="rounded-xl border border-hairline bg-canvas p-3.5"><div className="text-[11px] font-medium uppercase tracking-wide text-muted">Avg / customer</div><div className="mt-1 text-xl font-semibold tabular-nums text-ink">{f.avg_per_customer_cents != null ? `${money(f.avg_per_customer_cents)}/mo` : '—'}</div></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-hairline bg-canvas p-3.5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-ink"><TrendingUp className="h-4 w-4 text-subtle" /> Reach $1,000/mo</div>
              <div className="mt-1 text-sm text-subtle">{f.customers_to_1000 == null ? 'Add a customer to project this' : f.customers_to_1000 === 0 ? 'Unlocked' : <><span className="font-semibold text-ink">{f.customers_to_1000}</span> more customer{f.customers_to_1000 === 1 ? '' : 's'}</>}</div>
            </div>
            <div className="rounded-xl border border-hairline bg-canvas p-3.5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-ink"><TrendingUp className="h-4 w-4 text-subtle" /> Reach $5,000/mo</div>
              <div className="mt-1 text-sm text-subtle">{f.customers_to_5000 == null ? 'Add a customer to project this' : f.customers_to_5000 === 0 ? 'Unlocked' : <><span className="font-semibold text-ink">{f.customers_to_5000}</span> more customer{f.customers_to_5000 === 1 ? '' : 's'}</>}</div>
            </div>
            <div className="rounded-xl border border-hairline bg-canvas p-3.5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-ink"><Rocket className="h-4 w-4 text-subtle" /> Next tier</div>
              <div className="mt-1 text-sm text-subtle">{f.next_tier ? <><span className="font-semibold text-ink">{f.next_tier.pct}%</span> at {f.next_tier.at_customers} customers</> : 'You’re at the top tier'}</div>
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

// ── Payout timeline ──────────────────────────────────────────────────────
function PayoutTimeline({ s }: { s: Summary }) {
  const steps = [
    { key: 'pending', label: 'Pending', value: s.pending_cents, desc: 'Created, waiting through the approval period', dot: 'bg-amber-500' },
    { key: 'approved', label: 'Approved', value: s.approved_cents, desc: 'Cleared and ready for payout', dot: 'bg-blue-500' },
    { key: 'paid', label: 'Paid', value: s.paid_cents, desc: 'Sent to you or marked paid', dot: 'bg-green-500' },
  ]
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {steps.map((st, i) => (
        <div key={st.key} className="relative rounded-xl border border-hairline bg-canvas p-3.5">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${st.dot}`} />
            <span className="text-sm font-medium text-ink">{st.label}</span>
            {i < 2 && <ArrowRight className="ml-auto h-4 w-4 text-muted" />}
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{money(st.value)}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-muted">{st.desc}</div>
        </div>
      ))}
    </div>
  )
}

export function CommissionsView() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => { fetch('/api/partner/commissions').then((r) => r.json()).then(setData).catch(() => setErr(true)) }, [])

  function exportCsv() {
    if (!data) return
    const rows = [['Date', 'Customer', 'Event', 'Plan', 'Amount', 'Currency', 'Status', 'Source', 'Payout date']]
    for (const e of data.entries) rows.push([fmtDate(e.created_at), e.customer_name || '', EVENT_LABEL[e.entry_type] || e.entry_type, e.plan_name || '', (e.amount_cents / 100).toFixed(2), e.currency, e.status, e.source, e.payout_date ? fmtDate(e.payout_date) : ''])
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'scalix-commissions.csv'; a.click()
  }

  if (err) return <EmptyRow>Couldn’t load your commissions right now — please refresh.</EmptyRow>
  if (!data) return <EmptyRow>Loading…</EmptyRow>
  const s = data.summary

  return (
    <div className="space-y-6">
      <PayoutBanner />

      {/* Primary metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Monthly Recurring" value={money(s.monthly_recurring_income_cents)} accent hint="Your commission run-rate" />
        <StatCard label="Next Payout" value={money(s.estimated_next_payout_cents)} hint="Pending + approved" />
        <StatCard label="Lifetime Earned" value={money(s.lifetime_cents)} hint="Paid to date" />
        <StatCard label="Active Customers" value={s.active_customers} hint="Paying, attributed to you" />
      </div>

      <CommissionEngine f={data.forecast} />

      {/* Secondary metrics */}
      <Panel title="Breakdown">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Pending" value={money(s.pending_cents)} hint="Not yet approved" />
          <StatCard label="Approved" value={money(s.approved_cents)} hint="Awaiting payout" />
          <StatCard label="Paid" value={money(s.paid_cents)} hint="Received" />
          <StatCard label="Projected Annual" value={money(s.projected_annual_cents)} hint="Run-rate × 12" />
          <StatCard label="Portfolio Value" value={money(s.portfolio_value_cents)} hint="≈ 2× annual recurring" />
          <StatCard label="Expansion" value={money(s.expansion_cents)} hint="From upgrades" />
          <StatCard label="Churn (MRR)" value={money(s.churn_cents)} hint="Lost to cancellations" />
          <StatCard label="Avg. Commission" value={money(s.average_commission_cents)} hint="Per paid entry" />
        </div>
      </Panel>

      {/* Ledger */}
      <Panel title="Commission ledger" action={data.entries.length > 0 ? <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium text-subtle hover:text-ink"><Download className="h-3.5 w-3.5" /> Export CSV</button> : undefined}>
        {data.entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-hairline-strong bg-canvas p-8 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Wallet className="h-5 w-5" /></div>
            <h3 className="font-semibold text-ink">No commissions yet</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-subtle">Your first commission appears here after a referred customer becomes paid. Start by sharing a referral link or sending a live demo.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <a href="/partner/referrals" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Link2 className="h-4 w-4" /> Create referral link</a>
              <a href="/partner/demos" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><MonitorPlay className="h-4 w-4" /> Generate demo</a>
            </div>
          </div>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium sm:pl-0">Customer</th><th className="py-2 pr-3 font-medium">Event</th><th className="py-2 pr-3 font-medium">Plan</th>
                <th className="py-2 pr-3 text-right font-medium">Amount</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-4 font-medium sm:pr-0">Payout</th>
              </tr></thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className="border-b border-hairline/60">
                    <td className="px-4 py-2.5 font-medium text-ink sm:pl-0">{e.customer_name || <span className="text-muted">—</span>}</td>
                    <td className="py-2.5 pr-3 text-subtle">{EVENT_LABEL[e.entry_type] || e.entry_type}</td>
                    <td className="py-2.5 pr-3 text-subtle">{e.plan_name || <span className="text-muted">—</span>}</td>
                    <td className={`py-2.5 pr-3 text-right font-medium tabular-nums ${e.amount_cents < 0 ? 'text-red-600' : 'text-ink'}`}>{money(e.amount_cents, e.currency)}</td>
                    <td className="py-2.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[e.status] || ''}`}>{e.status}</span></td>
                    <td className="py-2.5 pr-3 capitalize text-muted">{e.source}</td>
                    <td className="py-2.5 pr-3 text-muted">{fmtDate(e.created_at)}</td>
                    <td className="py-2.5 pr-4 text-muted sm:pr-0">{e.payout_date ? fmtDate(e.payout_date) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle" /> Every commission is tracked from the original customer event. Refunds and chargebacks automatically adjust the ledger.</p>
      </Panel>

      {/* Payouts */}
      <Panel title="Payouts">
        <PayoutTimeline s={s} />
        <div className="mt-4">
          {data.payouts.length === 0 ? (
            <EmptyRow>No payouts yet — approved commissions appear here once they&apos;re sent.</EmptyRow>
          ) : (
            <div className="divide-y divide-hairline">
              {data.payouts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{money(p.amount_cents, p.currency)}</div>
                    <div className="truncate text-xs text-muted">{p.paid_at ? `Paid ${fmtDate(p.paid_at)}` : p.period_start ? `${p.period_start} → ${p.period_end}` : fmtDate(p.created_at)}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[p.status] || ''}`}>{p.status}</span>
                  {p.statement_url && <a href={p.statement_url} className="shrink-0 text-accent-strong hover:underline" title="Statement"><Download className="h-4 w-4" /></a>}
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
