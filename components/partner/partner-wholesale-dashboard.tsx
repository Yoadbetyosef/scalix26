'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader, StatCard, Panel, money } from '@/components/partner/ui'
import { effectiveItemPricing, type PriceBook, type PriceBookItem, type PartnerClient, type WholesaleSummary } from '@/lib/partner/wholesale'
import {
  Building2, Tag, Users, Plus, DownloadCloud, MonitorPlay, UserPlus, FileText, Percent, Layers, Info,
  Mail, X, Pencil, Flame, ShieldCheck, TrendingUp,
} from 'lucide-react'

const SUPPORT_EMAIL = 'partners@scalix26.com'
interface Data { clients: PartnerClient[]; summary: WholesaleSummary; priceBook: PriceBook | null; importableCount: number }

export function WholesalePartnerDashboard({ mode, companyName, streak, discount, markup }: {
  mode: 'white_label' | 'reseller'; companyName?: string | null; streak?: number; discount: number | null; markup: number | null
}) {
  const isWL = mode === 'white_label'
  const [data, setData] = useState<Data | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [edit, setEdit] = useState<PartnerClient | null>(null)
  const [agreementOpen, setAgreementOpen] = useState(false)

  const load = useCallback(async () => {
    const j = await fetch('/api/partner/clients').then((r) => r.json()).catch(() => null)
    if (j) setData(j)
  }, [])
  useEffect(() => { load() }, [load])

  async function importReferrals() {
    const r = await fetch('/api/partner/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ import: true }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return toast.error('Import failed')
    toast.success(j.imported ? `Imported ${j.imported} client${j.imported === 1 ? '' : 's'}` : 'No new paid clients to import'); load()
  }
  async function removeClient(id: string) { await fetch(`/api/partner/clients?id=${id}`, { method: 'DELETE' }); load() }

  const s = data?.summary
  const book = data?.priceBook
  const label = isWL ? 'White Label' : 'Reseller'

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
              ? 'You sell Scalix26 under your own brand or offer it as your AI service layer. Your profit is the difference between your client pricing and your Scalix26 wholesale cost.'
              : 'You buy Scalix26 at partner pricing and resell it to clients at your own price. Your profit is the spread.'}
          </p>
        </div>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Active Client Accounts" value={s ? s.active_clients : '—'} />
        <StatCard label={isWL ? 'Monthly Retail Revenue' : 'Monthly Resale Revenue'} value={s && s.has_pricing ? money(s.monthly_retail_cents) : '—'} />
        <StatCard label="Monthly Wholesale Cost" value={s && s.has_pricing ? money(s.monthly_wholesale_cents) : '—'} />
        <StatCard label={isWL ? 'Monthly Gross Profit' : 'Monthly Profit'} value={s && s.has_pricing ? money(s.gross_profit_cents) : '—'} accent />
        <StatCard label="Gross Margin %" value={s && s.margin_pct != null ? `${s.margin_pct}%` : '—'} />
        <StatCard label="Est. Annual Profit" value={s && s.has_pricing ? money(s.annual_profit_cents) : '—'} />
      </div>
      {s && s.active_clients > 0 && !s.has_pricing && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Add retail &amp; wholesale prices to your clients to calculate revenue and margin.</div>
      )}

      {/* Primary actions */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setAddOpen(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><UserPlus className="h-4 w-4" /> {isWL ? 'Add Client' : 'Add Resold Client'}</button>
        <a href="#price-book" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><Tag className="h-4 w-4" /> View Price Book</a>
        <a href="/partner/demos" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><MonitorPlay className="h-4 w-4" /> Create Client Demo</a>
        <a href="/partner/team" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><Users className="h-4 w-4" /> Invite Team</a>
        <button onClick={() => setAgreementOpen(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><FileText className="h-4 w-4" /> View Agreement</button>
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
                const p = effectiveItemPricing(it, { customWholesaleDiscountPct: discount, retailMarkupPct: markup })
                return (
                  <tr key={it.id} className="border-b border-hairline/60">
                    <td className="py-2 pr-3 font-medium text-ink">{it.plan_name}{it.notes && <span className="block text-[11px] font-normal text-muted">{it.notes}</span>}</td>
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

      {/* Client accounts */}
      <Panel
        title={<span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-accent-strong" /> Client Accounts</span>}
        action={
          <div className="flex gap-2">
            {data && data.importableCount > 0 && <button onClick={importReferrals} className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong px-2.5 py-1.5 text-xs font-medium text-subtle hover:text-ink"><DownloadCloud className="h-3.5 w-3.5" /> Import {data.importableCount} paid</button>}
            <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white"><Plus className="h-3.5 w-3.5" /> Add</button>
          </div>
        }
      >
        {!data ? <p className="py-6 text-center text-sm text-muted">Loading…</p> : data.clients.length === 0 ? (
          <div className="rounded-xl border border-dashed border-hairline-strong bg-canvas p-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Users className="h-5 w-5" /></div>
            <h3 className="font-semibold text-ink">No client accounts yet</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-subtle">Add the businesses you manage under your {label.toLowerCase()} account{data.importableCount > 0 ? ', or import your existing paid clients' : ''}. Set each client&apos;s retail price to track your margin.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button onClick={() => setAddOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><UserPlus className="h-4 w-4" /> Add client</button>
              {data.importableCount > 0 && <button onClick={importReferrals} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><DownloadCloud className="h-4 w-4" /> Import {data.importableCount} paid</button>}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm">
            <thead><tr className="border-b border-hairline text-left text-xs uppercase text-muted">
              <th className="py-2 pr-3">Client</th><th className="py-2 pr-3">Plan</th><th className="py-2 pr-3 text-right">Retail</th><th className="py-2 pr-3 text-right">Wholesale</th><th className="py-2 pr-3 text-right">Profit</th><th className="py-2 pr-3">Status</th><th className="py-2"></th>
            </tr></thead>
            <tbody>{data.clients.map((c) => {
              const profit = (c.retail_price_cents || 0) - (c.wholesale_price_cents || 0)
              return (
                <tr key={c.id} className="border-b border-hairline/60">
                  <td className="py-2 pr-3 font-medium text-ink">{c.business_name}</td>
                  <td className="py-2 pr-3 text-subtle">{c.plan_code || '—'}</td>
                  <td className="py-2 pr-3 text-right text-ink">{c.retail_price_cents != null ? money(c.retail_price_cents) : '—'}</td>
                  <td className="py-2 pr-3 text-right text-subtle">{c.wholesale_price_cents != null ? money(c.wholesale_price_cents) : '—'}</td>
                  <td className={`py-2 pr-3 text-right font-medium ${profit > 0 ? 'text-green-700' : 'text-subtle'}`}>{c.retail_price_cents != null || c.wholesale_price_cents != null ? money(profit) : '—'}</td>
                  <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${c.status === 'active' ? 'bg-green-50 text-green-700' : c.status === 'churned' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700'}`}>{c.status}</span></td>
                  <td className="py-2 text-right"><div className="flex justify-end gap-1"><button onClick={() => setEdit(c)} className="rounded border border-hairline-strong p-1.5 text-subtle hover:text-ink" title="Edit"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => removeClient(c.id)} className="rounded border border-hairline-strong p-1.5 text-muted hover:text-red-600" title="Remove"><X className="h-3.5 w-3.5" /></button></div></td>
                </tr>
              )
            })}</tbody>
          </table></div>
        )}
      </Panel>

      {/* Billing summary */}
      <Panel title={<span className="inline-flex items-center gap-2"><Layers className="h-4 w-4 text-accent-strong" /> Billing Summary</span>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <BillCell label={isWL ? 'Amount owed to Scalix26' : 'Balance due to Scalix26'} value={s && s.has_pricing ? `${money(s.monthly_wholesale_cents)}/mo` : '—'} icon={Percent} accent />
          <BillCell label={isWL ? 'Expected retail revenue' : 'Expected resale revenue'} value={s && s.has_pricing ? `${money(s.monthly_retail_cents)}/mo` : '—'} icon={TrendingUp} />
          <BillCell label="Gross profit" value={s && s.has_pricing ? `${money(s.gross_profit_cents)}/mo` : '—'} icon={Building2} />
          <BillCell label="Billing period" value={new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} icon={Layers} />
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Billing is currently managed by your Scalix26 agreement. Detailed automated billing will appear here once enabled. Questions? <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-accent-strong hover:underline">{SUPPORT_EMAIL}</a></p>
      </Panel>

      {addOpen && <ClientModal mode="create" book={book} discount={discount} markup={markup} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load() }} />}
      {edit && <ClientModal mode="edit" client={edit} book={book} discount={discount} markup={markup} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
      {agreementOpen && (
        <Modal title={`${label} agreement`} onClose={() => setAgreementOpen(false)}>
          <p className="text-sm leading-relaxed text-subtle">Your {isWL ? 'white-label' : 'reseller'} relationship — wholesale pricing, retail guidance, and billing — is governed by your Scalix26 partner agreement. For a copy of your agreement or billing details, contact our partner team.</p>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white"><Mail className="h-4 w-4" /> {SUPPORT_EMAIL}</a>
        </Modal>
      )}
    </div>
  )
}

function BillCell({ label, value, icon: Icon, accent }: { label: string; value: string; icon: typeof Tag; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-accent/25 bg-accent/[0.05]' : 'border-hairline bg-canvas'}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.04em] text-muted"><Icon className="h-3 w-3" />{label}</div>
      <div className={`mt-1 text-base font-semibold tabular-nums ${accent ? 'text-accent-strong' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5"><div className="font-semibold text-ink">{title}</div><button onClick={onClose} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

const inp = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
const lbl = 'mb-1 block text-xs font-medium text-subtle'

function ClientModal({ mode, client, book, discount, markup, onClose, onSaved }: { mode: 'create' | 'edit'; client?: PartnerClient; book: PriceBook | null | undefined; discount: number | null; markup: number | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(client?.business_name || '')
  const [itemId, setItemId] = useState('')
  const [planCode, setPlanCode] = useState(client?.plan_code || '')
  const [retail, setRetail] = useState(client?.retail_price_cents != null ? String(client.retail_price_cents / 100) : '')
  const [wholesale, setWholesale] = useState(client?.wholesale_price_cents != null ? String(client.wholesale_price_cents / 100) : '')
  const [status, setStatus] = useState(client?.status || 'active')

  function pickPlan(id: string) {
    setItemId(id)
    const it: PriceBookItem | undefined = book?.items.find((x) => x.id === id)
    if (it) {
      const p = effectiveItemPricing(it, { customWholesaleDiscountPct: discount, retailMarkupPct: markup })
      setPlanCode(it.plan_code); setWholesale(String(p.wholesale_cents / 100)); setRetail(String(p.retail_cents / 100))
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'create' && !name.trim()) return toast.error('Client name is required')
    const payload = {
      business_name: name.trim() || undefined, plan_code: planCode || null,
      price_book_item_id: itemId || null,
      retail_price_cents: retail ? Math.round(Number(retail) * 100) : null,
      wholesale_price_cents: wholesale ? Math.round(Number(wholesale) * 100) : null,
      status,
    }
    const r = mode === 'create'
      ? await fetch('/api/partner/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/partner/clients', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: client!.id, ...payload }) })
    if (!r.ok) return toast.error('Could not save client')
    toast.success(mode === 'create' ? 'Client added' : 'Client updated'); onSaved()
  }
  return (
    <Modal title={mode === 'create' ? 'Add client' : 'Edit client'} onClose={onClose}>
      <form className="space-y-3" onSubmit={save}>
        <div><label className={lbl}>Client business name</label><input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bright Locksmiths" /></div>
        {book && book.items.length > 0 && (
          <div><label className={lbl}>Plan (prefills pricing)</label>
            <select className={inp} value={itemId} onChange={(e) => pickPlan(e.target.value)}>
              <option value="">Custom / none</option>
              {book.items.map((it) => <option key={it.id} value={it.id}>{it.plan_name}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div><label className={lbl}>Retail price ($/mo)</label><input className={inp} inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="Your price" /></div>
          <div><label className={lbl}>Wholesale ($/mo)</label><input className={inp} inputMode="decimal" value={wholesale} onChange={(e) => setWholesale(e.target.value)} placeholder="Your cost" /></div>
        </div>
        <div><label className={lbl}>Status</label><select className={inp} value={status} onChange={(e) => setStatus(e.target.value)}>{['active', 'prospect', 'paused', 'churned'].map((x) => <option key={x} value={x} className="capitalize">{x}</option>)}</select></div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">Cancel</button>
          <button type="submit" className="h-10 flex-1 rounded-lg bg-ink text-sm font-medium text-white">{mode === 'create' ? 'Add client' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}
