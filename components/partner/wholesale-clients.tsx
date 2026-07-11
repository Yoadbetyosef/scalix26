'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { StatCard, money } from '@/components/partner/ui'
import { effectiveItemPricing, type PriceBook, type PriceBookItem, type PartnerClient, type WholesaleSummary } from '@/lib/partner/wholesale'
import { ProvisionClientWizard } from '@/components/partner/provision-client-wizard'
import { Plus, UserPlus, DownloadCloud, Search, X, Pencil, ChevronLeft, ChevronRight, Users, LogIn } from 'lucide-react'

interface Resp { clients: PartnerClient[]; page: number; pageSize: number; total: number; summary: WholesaleSummary; priceBook: PriceBook | null; overrides: { discount: number | null; markup: number | null }; importableCount: number }
const STATUSES = ['active', 'prospect', 'paused', 'churned']
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function WholesaleClients({ mode }: { mode: 'white_label' | 'reseller' }) {
  const isWL = mode === 'white_label'
  const [data, setData] = useState<Resp | null>(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [edit, setEdit] = useState<PartnerClient | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (p = page, query = q, st = status) => {
    const params = new URLSearchParams({ page: String(p) })
    if (query) params.set('q', query)
    if (st) params.set('status', st)
    const j = await fetch(`/api/partner/clients?${params}`).then((r) => r.json()).catch(() => null)
    if (j) { setData(j); setSelected(new Set()) }
  }, [page, q, status])
  useEffect(() => { load(page, q, status) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, status])
  // Debounced search
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { setPage(1); load(1, q, status) }, 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  async function importReferrals() {
    const r = await fetch('/api/partner/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ import: true }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return toast.error('Import failed')
    toast.success(j.imported ? `Imported ${j.imported} client${j.imported === 1 ? '' : 's'}` : 'No new paid clients to import'); load(page, q, status)
  }
  async function bulkStatus(newStatus: string) {
    const ids = [...selected]
    const r = await fetch('/api/partner/clients', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, status: newStatus }) })
    if (!r.ok) return toast.error('Bulk update failed')
    toast.success(`Updated ${ids.length} client${ids.length === 1 ? '' : 's'}`); load(page, q, status)
  }
  async function removeClient(id: string) { await fetch(`/api/partner/clients?id=${id}`, { method: 'DELETE' }); load(page, q, status) }
  async function enterWorkspace(tenantId: string) {
    const r = await fetch('/api/partner/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switch', tenantId }) })
    if (!r.ok) return toast.error('Could not open workspace')
    window.location.href = '/dashboard'
  }

  const s = data?.summary
  const total = data?.total ?? 0
  const pageSize = data?.pageSize ?? 25
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const rows = data?.clients ?? []
  const allSelected = rows.length > 0 && rows.every((c) => selected.has(c.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((c) => c.id)))
  const toggle = (id: string) => setSelected((s2) => { const n = new Set(s2); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active Clients" value={s ? s.active_clients : '—'} />
        <StatCard label={isWL ? 'Monthly Revenue' : 'Resale Revenue'} value={s && s.has_pricing ? money(s.monthly_retail_cents) : '—'} />
        <StatCard label={isWL ? 'Gross Profit' : 'Profit'} value={s && s.has_pricing ? money(s.gross_profit_cents) : '—'} accent />
        <StatCard label="Margin" value={s && s.margin_pct != null ? `${s.margin_pct}%` : '—'} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="h-10 w-full rounded-lg border border-hairline-strong pl-9 pr-3 text-sm outline-none focus:border-accent" />
        </div>
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }} className="h-10 rounded-lg border border-hairline-strong px-2 text-sm capitalize">
          <option value="">All statuses</option>{STATUSES.map((x) => <option key={x} value={x} className="capitalize">{x}</option>)}
        </select>
        {data && data.importableCount > 0 && <button onClick={importReferrals} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-hairline-strong px-3 text-sm font-medium text-subtle hover:text-ink"><DownloadCloud className="h-4 w-4" /> Import {data.importableCount}</button>}
        <button onClick={() => setAddOpen(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><UserPlus className="h-4 w-4" /> New Client</button>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.05] px-3 py-2 text-sm">
          <span className="font-medium text-ink">{selected.size} selected</span>
          <span className="text-muted">Set status:</span>
          {STATUSES.map((x) => <button key={x} onClick={() => bulkStatus(x)} className="rounded border border-hairline-strong bg-surface px-2 py-1 text-xs font-medium capitalize text-subtle hover:text-ink">{x}</button>)}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted hover:text-ink">Clear</button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl border border-hairline bg-surface shadow-e1">
        {!data ? <p className="py-10 text-center text-sm text-muted">Loading…</p> : rows.length === 0 ? (
          <div className="p-10 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Users className="h-5 w-5" /></div>
            <h3 className="font-semibold text-ink">{q || status ? 'No matching clients' : 'No client accounts yet'}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-subtle">{q || status ? 'Try a different search or filter.' : `Add the businesses you manage under your ${isWL ? 'white-label' : 'reseller'} account, then set each client's retail price to track your margin.`}</p>
            {!q && !status && <div className="mt-4 flex flex-wrap justify-center gap-2"><button onClick={() => setAddOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><UserPlus className="h-4 w-4" /> New client</button>{data.importableCount > 0 && <button onClick={importReferrals} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-subtle hover:text-ink"><DownloadCloud className="h-4 w-4" /> Import {data.importableCount} paid</button>}</div>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-hairline text-left text-xs uppercase text-muted">
                <th className="w-8 py-2 pl-4"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                <th className="py-2 pr-3">Business</th><th className="py-2 pr-3">Plan</th><th className="py-2 pr-3 text-right">Retail</th><th className="py-2 pr-3 text-right">Wholesale</th><th className="py-2 pr-3 text-right">Profit</th><th className="py-2 pr-3">Signup</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-4"></th>
              </tr></thead>
              <tbody>{rows.map((c) => {
                const profit = (c.retail_price_cents || 0) - (c.wholesale_price_cents || 0)
                const priced = c.retail_price_cents != null || c.wholesale_price_cents != null
                return (
                  <tr key={c.id} className="border-b border-hairline/60">
                    <td className="py-2.5 pl-4"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                    <td className="py-2.5 pr-3 font-medium text-ink">{c.business_name}</td>
                    <td className="py-2.5 pr-3 text-subtle">{c.plan_code || '—'}</td>
                    <td className="py-2.5 pr-3 text-right text-ink">{c.retail_price_cents != null ? money(c.retail_price_cents) : '—'}</td>
                    <td className="py-2.5 pr-3 text-right text-subtle">{c.wholesale_price_cents != null ? money(c.wholesale_price_cents) : '—'}</td>
                    <td className={`py-2.5 pr-3 text-right font-medium ${priced && profit > 0 ? 'text-green-700' : 'text-subtle'}`}>{priced ? money(profit) : '—'}</td>
                    <td className="py-2.5 pr-3 text-muted">{fmtDate(c.created_at)}</td>
                    <td className="py-2.5 pr-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${c.status === 'active' ? 'bg-green-50 text-green-700' : c.status === 'churned' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700'}`}>{c.status}</span></td>
                    <td className="py-2.5 pr-4 text-right"><div className="flex justify-end gap-1">{c.tenant_id && <button onClick={() => enterWorkspace(c.tenant_id!)} className="inline-flex items-center gap-1 rounded border border-hairline-strong px-2 py-1.5 text-xs font-medium text-subtle hover:text-ink" title="Open workspace"><LogIn className="h-3.5 w-3.5" /> Enter</button>}<button onClick={() => setEdit(c)} className="rounded border border-hairline-strong p-1.5 text-subtle hover:text-ink" title="Edit"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => removeClient(c.id)} className="rounded border border-hairline-strong p-1.5 text-muted hover:text-red-600" title="Remove"><X className="h-3.5 w-3.5" /></button></div></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
        {/* Pagination */}
        {data && total > 0 && (
          <div className="flex items-center justify-between border-t border-hairline px-4 py-2.5 text-xs text-muted">
            <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-hairline-strong p-1.5 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <span className="px-2">Page {page} / {pages}</span>
              <button disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="rounded border border-hairline-strong p-1.5 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </div>

      {addOpen && <ProvisionClientWizard book={data?.priceBook} discount={data?.overrides.discount ?? null} markup={data?.overrides.markup ?? null} onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load(1, q, status) }} />}
      {edit && <ClientModal mode="edit" client={edit} book={data?.priceBook} discount={data?.overrides.discount ?? null} markup={data?.overrides.markup ?? null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(page, q, status) }} />}
    </div>
  )
}

const inp = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
const lbl = 'mb-1 block text-xs font-medium text-subtle'

export function ClientModal({ mode, client, book, discount, markup, onClose, onSaved }: { mode: 'create' | 'edit'; client?: PartnerClient; book: PriceBook | null | undefined; discount: number | null; markup: number | null; onClose: () => void; onSaved: () => void }) {
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
      business_name: name.trim() || undefined, plan_code: planCode || null, price_book_item_id: itemId || null,
      retail_price_cents: retail ? Math.round(Number(retail) * 100) : null,
      wholesale_price_cents: wholesale ? Math.round(Number(wholesale) * 100) : null, status,
    }
    const r = mode === 'create'
      ? await fetch('/api/partner/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/partner/clients', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: client!.id, ...payload }) })
    if (!r.ok) return toast.error('Could not save client')
    toast.success(mode === 'create' ? 'Client added' : 'Client updated'); onSaved()
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5"><div className="font-semibold text-ink">{mode === 'create' ? 'Add client' : 'Edit client'}</div><button onClick={onClose} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button></div>
        <form className="space-y-3 p-5" onSubmit={save}>
          <div><label className={lbl}>Client business name</label><input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bright Locksmiths" /></div>
          {book && book.items.length > 0 && (
            <div><label className={lbl}>Plan (prefills pricing)</label>
              <select className={inp} value={itemId} onChange={(e) => pickPlan(e.target.value)}><option value="">Custom / none</option>{book.items.map((it) => <option key={it.id} value={it.id}>{it.plan_name}</option>)}</select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Retail ($/mo)</label><input className={inp} inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="Your price" /></div>
            <div><label className={lbl}>Wholesale ($/mo)</label><input className={inp} inputMode="decimal" value={wholesale} onChange={(e) => setWholesale(e.target.value)} placeholder="Your cost" /></div>
          </div>
          <div><label className={lbl}>Status</label><select className={inp} value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((x) => <option key={x} value={x} className="capitalize">{x}</option>)}</select></div>
          <div className="flex gap-2 pt-1"><button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">Cancel</button><button type="submit" className="h-10 flex-1 rounded-lg bg-ink text-sm font-medium text-white">{mode === 'create' ? 'Add client' : 'Save'}</button></div>
        </form>
      </div>
    </div>
  )
}
