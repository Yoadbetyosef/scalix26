'use client'

import { useEffect, useState } from 'react'
import MarkupEditor from '@/components/admin/markup-editor'

interface Billing {
  plan: { mrr: number; arr: number; payingCustomers: number; trials: number }
  stripe: null | { mrr: number; activeSubscriptions: number; pastDue: number; openInvoices: number }
  clv: number | null
}

const money = (n: number) => `$${n.toLocaleString()}`

export default function AdminBillingPage() {
  const [b, setB] = useState<Billing | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/billing')
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Failed to load')
        setB(d)
      } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
    })()
  }, [])

  const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="rounded-xl border border-hairline-strong bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink">{value}</div>
      {sub && <div className="text-xs text-subtle">{sub}</div>}
    </div>
  )

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-ink mb-1">Billing</h1>
      <p className="text-sm text-subtle mb-6">Revenue from plans, plus live Stripe status.</p>

      {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}

      <h2 className="mb-2 text-sm font-semibold text-ink">White Label pricing</h2>
      <div className="mb-6"><MarkupEditor /></div>

      {loading || !b ? <p className="text-sm text-muted">Loading…</p> : (
        <>
          <h2 className="mb-2 text-sm font-semibold text-ink">Plan revenue</h2>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="MRR" value={money(b.plan.mrr)} />
            <Tile label="ARR" value={money(b.plan.arr)} />
            <Tile label="Paying customers" value={b.plan.payingCustomers.toLocaleString()} />
            <Tile label="Trials" value={b.plan.trials.toLocaleString()} />
          </div>

          <h2 className="mb-2 text-sm font-semibold text-ink">Stripe (live)</h2>
          {b.stripe ? (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Stripe MRR" value={money(b.stripe.mrr)} sub="from active subscriptions" />
              <Tile label="Active subs" value={b.stripe.activeSubscriptions.toLocaleString()} />
              <Tile label="Past due" value={b.stripe.pastDue.toLocaleString()} />
              <Tile label="Open invoices" value={b.stripe.openInvoices.toLocaleString()} />
            </div>
          ) : (
            <div className="mb-6 rounded-xl border border-hairline-strong bg-white p-4 text-sm text-subtle">
              Stripe data unavailable (not configured or unreachable).
            </div>
          )}

          <h2 className="mb-2 text-sm font-semibold text-ink">Lifetime value</h2>
          <div className="rounded-xl border border-hairline-strong bg-white p-4 text-sm text-subtle">
            Customer Lifetime Value — <span className="font-medium">Not tracked yet</span> (needs historical revenue analysis; wired with the Stripe invoice pipeline).
          </div>
        </>
      )}
    </div>
  )
}
