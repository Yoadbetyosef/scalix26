'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, StatCard, Panel, money } from '@/components/partner/ui'
import { effectiveItemPricing, type PriceBook, type PartnerClient, type WholesaleSummary } from '@/lib/partner/wholesale'
import { Building2, Tag, Users, UserPlus, Layers, Info, Mail, X, Flame, ShieldCheck, TrendingUp, ArrowRight, CreditCard, Percent } from 'lucide-react'

const SUPPORT_EMAIL = 'partners@scalix26.com'
interface Data { clients: PartnerClient[]; summary: WholesaleSummary; priceBook: PriceBook | null; overrides: { discount: number | null; markup: number | null }; total: number }

export function WholesalePartnerDashboard({ mode, companyName, streak }: {
  mode: 'white_label' | 'reseller'; companyName?: string | null; streak?: number; discount?: number | null; markup?: number | null
}) {
  const isWL = mode === 'white_label'
  const [data, setData] = useState<Data | null>(null)
  const [agreementOpen, setAgreementOpen] = useState(false)
  useEffect(() => { fetch('/api/partner/clients?page=1').then((r) => r.json()).then(setData).catch(() => {}) }, [])

  const s = data?.summary
  const book = data?.priceBook
  const label = isWL ? 'White Label' : 'Reseller'
  const snapshot = (data?.clients || []).slice(0, 6)

  return (
    <div className="space-y-5 sm:space-y-6 sx-animate-in">
      <PageHeader
        title={`Welcome back${companyName ? `, ${companyName}` : ''}`}
        subtitle={isWL ? 'Your white-label business — your clients, your pricing, your margin.' : 'Your reseller business — your clients, your cost, your profit.'}
        action={streak && streak > 0 ? <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-600"><Flame className="h-4 w-4" /> {streak}-day streak</span> : undefined}
      />

      {/* Hero */}
      <div className="flex items-start gap-3 rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/[0.06] to-transparent p-5 shadow-e1">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-strong"><Building2 className="h-5 w-5" /></span>
        <div>
          <div className="text-[15px] font-semibold text-ink">{label} Partner</div>
          <p className="mt-0.5 max-w-xl text-sm text-subtle">
            {isWL
              ? 'You sell Scalix26 under your own brand. Your profit is the difference between your client pricing and your Scalix26 wholesale cost.'
              : 'You buy Scalix26 at partner pricing and resell it to clients at your own price. Your profit is the spread.'}
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active Client Accounts" value={s ? s.active_clients.toLocaleString() : '—'} />
        <StatCard label={isWL ? 'Monthly Client Revenue' : 'Monthly Resale Revenue'} value={s && s.has_pricing ? money(s.monthly_retail_cents) : '—'} />
        <StatCard label="Monthly Wholesale Cost" value={s && s.has_pricing ? money(s.monthly_wholesale_cents) : '—'} />
        <StatCard label={isWL ? 'Monthly Gross Profit' : 'Monthly Profit'} value={s && s.has_pricing ? money(s.gross_profit_cents) : '—'} accent />
        <StatCard label="Profit Margin" value={s && s.margin_pct != null ? `${s.margin_pct}%` : '—'} />
        <StatCard label="New Clients This Month" value={s ? s.new_this_month.toLocaleString() : '—'} />
        <StatCard label="Churn" value={s ? s.churned.toLocaleString() : '—'} hint="Churned accounts" />
        <StatCard label="Pending Payments" value={s && s.has_pricing ? money(s.pending_payments_cents) : '—'} hint="Owed to Scalix26 / mo" />
      </div>
      {s && s.active_clients > 0 && !s.has_pricing && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Set retail &amp; wholesale prices on your clients to calculate revenue and margin.</div>
      )}

      {/* Primary actions */}
      <div className="flex flex-wrap gap-2">
        <Link href="/partner/clients" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><UserPlus className="h-4 w-4" /> Add Client</Link>
        <a href="#price-book" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><Tag className="h-4 w-4" /> View Price Book</a>
        <Link href="/partner/billing" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><CreditCard className="h-4 w-4" /> Billing</Link>
        <Link href="/partner/team" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><Users className="h-4 w-4" /> Invite Team</Link>
        <button onClick={() => setAgreementOpen(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><ShieldCheck className="h-4 w-4" /> View Agreement</button>
      </div>

      {/* Price book */}
      <div id="price-book">
        <Panel title={<span className="inline-flex items-center gap-2"><Tag className="h-4 w-4 text-accent-strong" /> Price Book{book ? ` · ${book.name}` : ''}</span>}>
          {!book || book.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-hairline-strong bg-canvas p-6 text-center">
              <p className="mx-auto max-w-md text-sm text-subtle">No price book is assigned yet. Your {isWL ? 'white-label' : 'reseller'} pricing is set by your Scalix26 agreement.</p>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Mail className="h-4 w-4" /> {SUPPORT_EMAIL}</a>
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-hairline text-left text-xs uppercase text-muted">
                <th className="py-2 pr-3">Plan</th><th className="py-2 pr-3 text-right">Your wholesale</th><th className="py-2 pr-3 text-right">Suggested retail</th><th className="py-2 pr-3 text-right">Est. profit</th><th className="py-2 text-right">Margin</th>
              </tr></thead>
              <tbody>{book.items.map((it) => {
                const p = effectiveItemPricing(it, { customWholesaleDiscountPct: data?.overrides.discount ?? null, retailMarkupPct: data?.overrides.markup ?? null })
                return (
                  <tr key={it.id} className="border-b border-hairline/60">
                    <td className="py-2 pr-3 font-medium text-ink">{it.plan_name}</td>
                    <td className="py-2 pr-3 text-right text-ink">{money(p.wholesale_cents)}/mo</td>
                    <td className="py-2 pr-3 text-right text-subtle">{money(p.retail_cents)}/mo</td>
                    <td className="py-2 pr-3 text-right font-medium text-green-700">{money(p.margin_cents)}/mo</td>
                    <td className="py-2 text-right font-medium text-ink">{p.margin_pct}%</td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          )}
        </Panel>
      </div>

      {/* Client snapshot */}
      <Panel
        title={<span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-accent-strong" /> Client Accounts</span>}
        action={<Link href="/partner/clients" className="inline-flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline">Manage all{data ? ` (${data.total.toLocaleString()})` : ''} <ArrowRight className="h-3.5 w-3.5" /></Link>}
      >
        {!data ? <p className="py-6 text-center text-sm text-muted">Loading…</p> : snapshot.length === 0 ? (
          <div className="rounded-xl border border-dashed border-hairline-strong bg-canvas p-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Users className="h-5 w-5" /></div>
            <h3 className="font-semibold text-ink">No client accounts yet</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-subtle">Add the businesses you manage and set each client&apos;s retail price to track your margin.</p>
            <Link href="/partner/clients" className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><UserPlus className="h-4 w-4" /> Add clients</Link>
          </div>
        ) : (
          <div className="divide-y divide-hairline">
            {snapshot.map((c) => {
              const profit = (c.retail_price_cents || 0) - (c.wholesale_price_cents || 0)
              const priced = c.retail_price_cents != null || c.wholesale_price_cents != null
              return (
                <div key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="flex-1 truncate font-medium text-ink">{c.business_name}</span>
                  <span className="hidden text-muted sm:block">{c.plan_code || '—'}</span>
                  <span className="w-20 text-right text-subtle">{c.retail_price_cents != null ? money(c.retail_price_cents) : '—'}</span>
                  <span className={`w-20 text-right font-medium ${priced && profit > 0 ? 'text-green-700' : 'text-subtle'}`}>{priced ? money(profit) : '—'}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${c.status === 'active' ? 'bg-green-50 text-green-700' : c.status === 'churned' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700'}`}>{c.status}</span>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {/* Billing summary */}
      <Panel title={<span className="inline-flex items-center gap-2"><Layers className="h-4 w-4 text-accent-strong" /> Billing Summary</span>} action={<Link href="/partner/billing" className="inline-flex items-center gap-1 text-xs font-medium text-accent-strong hover:underline">Open billing <ArrowRight className="h-3.5 w-3.5" /></Link>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Bill label={isWL ? 'Amount owed to Scalix26' : 'Balance due'} value={s && s.has_pricing ? `${money(s.monthly_wholesale_cents)}/mo` : '—'} icon={Percent} accent />
          <Bill label={isWL ? 'Expected retail revenue' : 'Expected resale revenue'} value={s && s.has_pricing ? `${money(s.monthly_retail_cents)}/mo` : '—'} icon={TrendingUp} />
          <Bill label="Gross profit" value={s && s.has_pricing ? `${money(s.gross_profit_cents)}/mo` : '—'} icon={Building2} />
          <Bill label="Billing period" value={new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} icon={Layers} />
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Billing is managed by your Scalix26 agreement. Questions? <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-accent-strong hover:underline">{SUPPORT_EMAIL}</a></p>
      </Panel>

      {agreementOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setAgreementOpen(false)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5"><div className="font-semibold text-ink">{label} agreement</div><button onClick={() => setAgreementOpen(false)} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button></div>
            <div className="p-5">
              <p className="text-sm leading-relaxed text-subtle">Your {isWL ? 'white-label' : 'reseller'} relationship — wholesale pricing, retail guidance, and billing — is governed by your Scalix26 partner agreement.</p>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white"><Mail className="h-4 w-4" /> {SUPPORT_EMAIL}</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Bill({ label, value, icon: Icon, accent }: { label: string; value: string; icon: typeof Tag; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-accent/25 bg-accent/[0.05]' : 'border-hairline bg-canvas'}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.04em] text-muted"><Icon className="h-3 w-3" />{label}</div>
      <div className={`mt-1 text-base font-semibold tabular-nums ${accent ? 'text-accent-strong' : 'text-ink'}`}>{value}</div>
    </div>
  )
}
