'use client'

import { useEffect, useState } from 'react'
import { StatCard, Panel, money } from '@/components/partner/ui'
import type { WholesaleSummary } from '@/lib/partner/wholesale'
import { FileText, CreditCard, ShieldCheck, Mail, Receipt } from 'lucide-react'

const SUPPORT_EMAIL = 'partners@scalix26.com'

export function WholesaleBilling({ mode }: { mode: 'white_label' | 'reseller' }) {
  const isWL = mode === 'white_label'
  const [s, setS] = useState<WholesaleSummary | null>(null)
  useEffect(() => { fetch('/api/partner/clients?page=1').then((r) => r.json()).then((j) => setS(j.summary)).catch(() => {}) }, [])

  const nextInvoice = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const hasBalance = s && s.has_pricing

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Current Balance" value={hasBalance ? money(s.monthly_wholesale_cents) : '—'} accent hint="Owed to Scalix26 / mo" />
        <StatCard label="Next Invoice" value={hasBalance ? money(s.monthly_wholesale_cents) : '—'} hint={nextInvoice} />
        <StatCard label="Active Clients" value={s ? s.active_clients : '—'} />
        <StatCard label={isWL ? 'Client Revenue' : 'Resale Revenue'} value={hasBalance ? money(s.monthly_retail_cents) : '—'} hint="Your monthly, per agreement" />
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-accent/20 bg-accent/[0.04] px-3.5 py-3 text-sm text-subtle">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
        <div>Your {isWL ? 'white-label' : 'reseller'} billing is currently <span className="font-medium text-ink">managed by your Scalix26 agreement</span>. Automated invoices &amp; payments will appear below once enabled. Your current wholesale balance is calculated live from your active client accounts.</div>
      </div>

      <Panel title={<span className="inline-flex items-center gap-2"><Receipt className="h-4 w-4 text-accent-strong" /> Wholesale invoices</span>}>
        <div className="rounded-xl border border-dashed border-hairline-strong bg-canvas p-6 text-center text-sm text-subtle">No invoices yet. Automated wholesale invoicing will appear here once enabled — until then, invoicing is handled directly per your agreement.</div>
      </Panel>

      <Panel title={<span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-accent-strong" /> Payments</span>}>
        <div className="rounded-xl border border-dashed border-hairline-strong bg-canvas p-6 text-center text-sm text-subtle">No payment history yet.</div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={<span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4 text-accent-strong" /> Payment method</span>}>
          <p className="text-sm text-subtle">Your payment method is set up with our partner team as part of your agreement.</p>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><Mail className="h-4 w-4" /> {SUPPORT_EMAIL}</a>
        </Panel>
        <Panel title={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent-strong" /> Agreement</span>}>
          <p className="text-sm text-subtle">Your {isWL ? 'white-label' : 'reseller'} pricing, terms, and billing schedule are governed by your Scalix26 partner agreement.</p>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Mail className="h-4 w-4" /> Request agreement details</a>
        </Panel>
      </div>
    </div>
  )
}
