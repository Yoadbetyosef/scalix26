'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { StatCard, Panel, EmptyRow, money } from '@/components/partner/ui'
import { MarketingLibrary } from '@/components/partner/marketing-library'
import { RoiCalculator } from '@/components/partner/roi-calculator'
import { Megaphone, Palette, LayoutTemplate, DollarSign, BarChart3, FolderOpen, Plus, Copy, ExternalLink, Pencil, Pause, Play, Archive, X, type LucideIcon } from 'lucide-react'

type Tab = 'performance' | 'campaigns' | 'creatives' | 'landing' | 'spend' | 'assets'
const input = 'h-9 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// Educational empty state — never a bare "No X". Explains why the surface exists + a next step.
function EducationalEmpty({ icon: Icon, title, body, cta }: { icon: LucideIcon; title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline-strong bg-surface p-10 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent-strong"><Icon className="h-5 w-5" /></div>
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-subtle">{body}</p>
      {cta && <div className="mt-4 flex justify-center">{cta}</div>}
    </div>
  )
}

export function MarketingOS() {
  const [tab, setTab] = useState<Tab>('performance')
  const tabs: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
    { key: 'performance', label: 'Performance', icon: BarChart3 },
    { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
    { key: 'creatives', label: 'Creatives', icon: Palette },
    { key: 'landing', label: 'Landing Pages', icon: LayoutTemplate },
    { key: 'spend', label: 'Ad Spend', icon: DollarSign },
    { key: 'assets', label: 'Assets', icon: FolderOpen },
  ]
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1 border-b border-hairline">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === t.key ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'performance' && <Performance />}
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'creatives' && <Creatives />}
      {tab === 'landing' && <Landing />}
      {tab === 'spend' && <Spend />}
      {tab === 'assets' && <div className="space-y-6"><RoiCalculator /><MarketingLibrary /></div>}
    </div>
  )
}

// ── Performance ──
interface CampaignPerf { campaign_id: string; name: string; channel: string | null; clicks: number; signups: number; paid: number; commission_cents: number; spend_cents: number; cac_cents: number | null; roi_pct: number | null; ltv_cents: number | null; payback_months: number | null }
interface CreativePerf { creative_id: string; title: string; type: string; status: string; clicks: number; signups: number; paid: number; commission_cents: number }
function Performance() {
  const [d, setD] = useState<{ campaigns: CampaignPerf[]; creatives: CreativePerf[]; overall: { spend_cents: number; commission_cents: number; paid: number; cac_cents: number | null; roi_pct: number | null } } | null>(null)
  useEffect(() => { fetch('/api/partner/marketing/performance').then((r) => r.json()).then(setD) }, [])
  if (!d) return <EmptyRow>Loading…</EmptyRow>
  const o = d.overall
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ad Spend" value={money(o.spend_cents)} />
        <StatCard label="Commission" value={money(o.commission_cents)} accent />
        <StatCard label="Blended CAC" value={o.cac_cents != null ? money(o.cac_cents) : '—'} hint="Spend ÷ paid" />
        <StatCard label="ROI" value={o.roi_pct != null ? `${o.roi_pct}%` : '—'} />
      </div>
      <Panel title="Campaign performance">
        {d.campaigns.length === 0 ? (
          <EducationalEmpty icon={BarChart3} title="Your ROI shows up here"
            body="Once you create a campaign and start driving clicks, this table ranks every campaign by the customers and commission it produced — with live CAC and ROI. Head to the Campaigns tab to launch your first one." />
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-hairline text-left text-xs uppercase text-muted">
              <th className="py-2 pr-3">Campaign</th><th className="py-2 pr-3 text-right">Clicks</th><th className="py-2 pr-3 text-right">Paid</th>
              <th className="py-2 pr-3 text-right">Spend</th><th className="py-2 pr-3 text-right">CAC</th><th className="py-2 pr-3 text-right">Commission</th><th className="py-2 text-right">ROI</th>
            </tr></thead>
            <tbody>{d.campaigns.map((c) => (
              <tr key={c.campaign_id} className="border-b border-hairline/60">
                <td className="py-2 pr-3 text-ink">{c.name}{c.channel && <span className="ml-1 text-xs text-muted">· {c.channel}</span>}</td>
                <td className="py-2 pr-3 text-right text-subtle">{c.clicks}</td>
                <td className="py-2 pr-3 text-right font-medium text-ink">{c.paid}</td>
                <td className="py-2 pr-3 text-right text-subtle">{money(c.spend_cents)}</td>
                <td className="py-2 pr-3 text-right text-subtle">{c.cac_cents != null ? money(c.cac_cents) : '—'}</td>
                <td className="py-2 pr-3 text-right text-green-700">{money(c.commission_cents)}</td>
                <td className={`py-2 text-right font-medium ${(c.roi_pct ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{c.roi_pct != null ? `${c.roi_pct}%` : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <Panel title="Top creatives">
        {d.creatives.length === 0 ? (
          <EducationalEmpty icon={Palette} title="Find your winning message"
            body="Add ad copy, scripts, and templates in the Creatives tab. As they drive clicks and customers, the best performers rise to the top here so you can double down on what works." />
        ) : (
          <div className="divide-y divide-hairline">{d.creatives.slice(0, 10).map((c) => (
            <div key={c.creative_id} className="flex items-center gap-3 py-2.5">
              <span className="rounded-full bg-sunken px-2 py-0.5 text-xs capitalize text-subtle">{c.type.replace('_', ' ')}</span>
              <span className="flex-1 truncate text-sm text-ink">{c.title}</span>
              <span className="text-xs text-muted">{c.clicks} clicks · {c.paid} paid · {money(c.commission_cents)}</span>
            </div>
          ))}</div>
        )}
      </Panel>
    </div>
  )
}

// ── Campaigns (manager) ──
const CHANNELS = ['meta', 'google', 'tiktok', 'linkedin', 'organic', 'email', 'other']
interface CampaignRow {
  campaign_id: string; name: string; channel: string | null; status: string; budget_cents: number | null; created_at: string
  clicks: number; signups: number; demos: number; paid: number; spend_cents: number; roi_pct: number | null; landing_pages: number; creatives: number
}
const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-50 text-green-700', paused: 'bg-amber-50 text-amber-700',
  archived: 'bg-gray-100 text-gray-500', draft: 'bg-sunken text-subtle',
}

function CampaignMetric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.04em] text-muted">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-600' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

function Campaigns() {
  const [rows, setRows] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')
  const [showCreate, setShowCreate] = useState(false)
  const [f, setF] = useState({ name: '', channel: 'meta', budget: '' })
  const [edit, setEdit] = useState<CampaignRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const j = await fetch('/api/partner/marketing/performance').then((r) => r.json())
    setRows(j.campaigns || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const r = await fetch('/api/partner/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, channel: f.channel, budget_cents: f.budget ? Math.round(Number(f.budget) * 100) : null }) })
    if (!r.ok) return toast.error('Could not create campaign')
    toast.success('Campaign created'); setF({ name: '', channel: 'meta', budget: '' }); setShowCreate(false); load()
  }
  async function patch(id: string, body: Record<string, unknown>, msg?: string) {
    const r = await fetch('/api/partner/campaigns', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    if (!r.ok) return toast.error('Could not update campaign')
    if (msg) toast.success(msg); load()
  }

  const filters = ['All', 'Active', 'Paused', 'Archived']
  const shown = rows.filter((r) => filter === 'All' ? r.status !== 'archived' : r.status === filter.toLowerCase())
  const archivedCount = rows.filter((r) => r.status === 'archived').length

  const createForm = (
    <Panel title="New campaign">
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input className={`${input} flex-1 min-w-[180px]`} placeholder="e.g. Meta — Locksmith Q3" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <select className={`${input} w-32`} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} className="capitalize">{c}</option>)}</select>
        <input className={`${input} w-32`} placeholder="Budget $" inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
        <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create</button>
      </form>
    </Panel>
  )

  return (
    <div className="space-y-5">
      {loading ? <EmptyRow>Loading…</EmptyRow> : rows.length === 0 ? (
        <>
          <EducationalEmpty icon={Megaphone}
            title="Run your outreach as campaigns, not guesswork"
            body="A campaign groups the links, creatives, and ad spend behind one initiative — so you can see exactly which channel and message turns clicks into paying customers, and what your ROI is. Create your first one to start attributing every signup back to its source."
            cta={<button onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create your first campaign</button>} />
          {showCreate && createForm}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {filters.map((s) => {
                if (s === 'Archived' && archivedCount === 0) return null
                return (
                  <button key={s} onClick={() => setFilter(s)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === s ? 'bg-ink text-white' : 'bg-sunken text-subtle hover:text-ink'}`}>{s}</button>
                )
              })}
            </div>
            <button onClick={() => setShowCreate((v) => !v)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> New campaign</button>
          </div>
          {showCreate && createForm}

          {shown.length === 0 ? (
            <EducationalEmpty icon={Megaphone} title={`No ${filter.toLowerCase()} campaigns`}
              body={filter === 'Active' ? 'Nothing running right now. Create a campaign or resume a paused one to start driving attributed traffic.' : 'Switch filters to see your other campaigns.'} />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {shown.map((c) => {
                const cac = c.paid > 0 ? c.spend_cents / c.paid : null
                return (
                  <div key={c.campaign_id} className="flex flex-col rounded-2xl border border-hairline bg-surface p-4 shadow-e1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink">{c.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                          {c.channel && <span className="rounded-full bg-sunken px-2 py-0.5 font-medium capitalize text-subtle">{c.channel}</span>}
                          <span>Created {fmtDate(c.created_at)}</span>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[c.status] || STATUS_STYLE.draft}`}>{c.status}</span>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-x-3 gap-y-3 border-t border-hairline pt-3">
                      <CampaignMetric label="Budget" value={c.budget_cents != null ? money(c.budget_cents) : '—'} />
                      <CampaignMetric label="Spend" value={money(c.spend_cents)} />
                      <CampaignMetric label="Clicks" value={String(c.clicks)} />
                      <CampaignMetric label="Leads" value={String(c.signups)} />
                      <CampaignMetric label="Demos" value={String(c.demos)} />
                      <CampaignMetric label="Customers" value={String(c.paid)} />
                      <CampaignMetric label="CAC" value={cac != null ? money(cac) : '—'} />
                      <CampaignMetric label="ROI" value={c.roi_pct != null ? `${c.roi_pct}%` : '—'} tone={c.roi_pct == null ? undefined : c.roi_pct >= 0 ? 'good' : 'bad'} />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3">
                      <div className="text-[11px] text-muted">{c.landing_pages} landing {c.landing_pages === 1 ? 'page' : 'pages'} · {c.creatives} {c.creatives === 1 ? 'creative' : 'creatives'}</div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEdit(c)} title="Edit" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                        {c.status === 'active' ? (
                          <button onClick={() => patch(c.campaign_id, { status: 'paused' }, 'Campaign paused')} title="Pause" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Pause className="h-3.5 w-3.5" /></button>
                        ) : c.status !== 'archived' ? (
                          <button onClick={() => patch(c.campaign_id, { status: 'active' }, 'Campaign resumed')} title="Resume" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Play className="h-3.5 w-3.5" /></button>
                        ) : null}
                        {c.status !== 'archived' ? (
                          <button onClick={() => patch(c.campaign_id, { status: 'archived' }, 'Campaign archived')} title="Archive" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Archive className="h-3.5 w-3.5" /></button>
                        ) : (
                          <button onClick={() => patch(c.campaign_id, { status: 'paused' }, 'Campaign restored')} title="Restore" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Play className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {edit && <EditCampaignModal row={edit} onClose={() => setEdit(null)} onSave={async (body) => { await patch(edit.campaign_id, body, 'Campaign updated'); setEdit(null) }} />}
    </div>
  )
}

function EditCampaignModal({ row, onClose, onSave }: { row: CampaignRow; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [name, setName] = useState(row.name)
  const [channel, setChannel] = useState(row.channel || 'other')
  const [budget, setBudget] = useState(row.budget_cents != null ? String(row.budget_cents / 100) : '')
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <div className="font-semibold text-ink">Edit campaign</div>
          <button onClick={onClose} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button>
        </div>
        <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); onSave({ name, channel, budget_cents: budget ? Math.round(Number(budget) * 100) : null }) }}>
          <div><label className="mb-1 block text-xs font-medium text-subtle">Name</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div><label className="mb-1 block text-xs font-medium text-subtle">Channel</label><select className={input} value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c} className="capitalize">{c}</option>)}</select></div>
          <div><label className="mb-1 block text-xs font-medium text-subtle">Budget ($)</label><input className={input} inputMode="decimal" placeholder="Optional" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">Cancel</button>
            <button type="submit" className="h-10 flex-1 rounded-lg bg-ink text-sm font-medium text-white">Save changes</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Creatives ──
interface Creative { id: string; type: string; title: string; body: string | null; status: string; partner_id: string | null }
function Creatives() {
  const [mine, setMine] = useState<Creative[]>([]); const [official, setOfficial] = useState<Creative[]>([])
  const [f, setF] = useState({ type: 'ad_copy', title: '', body: '' })
  const load = useCallback(async () => { const j = await fetch('/api/partner/creatives').then((r) => r.json()); setMine(j.mine || []); setOfficial(j.official || []) }, [])
  useEffect(() => { load() }, [load])
  async function create(e: React.FormEvent) { e.preventDefault(); const r = await fetch('/api/partner/creatives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) }); if (!r.ok) return toast.error('Failed'); toast.success('Creative added'); setF({ type: 'ad_copy', title: '', body: '' }); load() }
  async function setStatus(id: string, status: string) { await fetch('/api/partner/creatives', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); load() }
  async function clone(id: string) { const r = await fetch('/api/partner/creatives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cloneFrom: id }) }); if (!r.ok) return toast.error('Failed'); toast.success('Cloned to your library'); load() }
  const badge = (s: string) => s === 'winner' ? 'bg-green-50 text-green-700' : s === 'testing' ? 'bg-amber-50 text-amber-700' : s === 'archived' ? 'bg-gray-100 text-gray-500' : 'bg-sunken text-subtle'
  return (
    <div className="space-y-6">
      <Panel title="New creative">
        <form onSubmit={create} className="space-y-2">
          <div className="flex gap-2">
            <select className={`${input} w-40`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['ad_copy', 'headline', 'video', 'image', 'landing_page', 'email', 'sms', 'call_script', 'follow_up_sequence'].map((t) => <option key={t}>{t}</option>)}</select>
            <input className={`${input} flex-1`} placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
          </div>
          <textarea className="w-full rounded-lg border border-hairline-strong p-2.5 text-sm outline-none focus:border-accent" rows={2} placeholder="Body / copy / script…" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Add creative</button>
        </form>
      </Panel>
      <Panel title="Your creatives">
        {mine.length === 0 ? (
          <EducationalEmpty icon={Palette} title="Build your creative library"
            body="Save the ad copy, headlines, scripts, and email sequences you actually use. Mark the ones that convert as “winner”, or clone a proven asset from the official library below to start fast." />
        ) : <div className="divide-y divide-hairline">{mine.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-2.5">
            <span className="rounded-full bg-sunken px-2 py-0.5 text-xs capitalize text-subtle">{c.type.replace('_', ' ')}</span>
            <span className="flex-1 truncate text-sm text-ink">{c.title}</span>
            <select value={c.status} onChange={(e) => setStatus(c.id, e.target.value)} className={`h-7 rounded-md px-1.5 text-xs font-medium ${badge(c.status)}`}>{['draft', 'testing', 'winner', 'archived'].map((s) => <option key={s}>{s}</option>)}</select>
          </div>
        ))}</div>}
      </Panel>
      <Panel title="Official Scalix library">
        {official.length === 0 ? <EmptyRow>No official creatives yet.</EmptyRow> : <div className="divide-y divide-hairline">{official.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-2.5">
            <span className="rounded-full bg-sunken px-2 py-0.5 text-xs capitalize text-subtle">{c.type.replace('_', ' ')}</span>
            <span className="flex-1 truncate text-sm text-ink">{c.title}</span>
            <button onClick={() => clone(c.id)} className="inline-flex items-center gap-1 rounded-md border border-hairline-strong px-2 py-1 text-xs text-subtle hover:text-ink"><Copy className="h-3.5 w-3.5" /> Clone</button>
          </div>
        ))}</div>}
      </Panel>
    </div>
  )
}

// ── Landing pages ──
interface LP { id: string; slug: string; headline: string; view_count: number }
function Landing() {
  const [list, setList] = useState<LP[]>([]); const [f, setF] = useState({ headline: '', subhead: '', cta_text: 'Get started free' }); const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])
  const load = useCallback(async () => { const j = await fetch('/api/partner/landing-pages').then((r) => r.json()); setList(j.pages || []) }, [])
  useEffect(() => { load() }, [load])
  async function create(e: React.FormEvent) { e.preventDefault(); const r = await fetch('/api/partner/landing-pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) }); if (!r.ok) return toast.error('Failed'); toast.success('Landing page created'); setF({ headline: '', subhead: '', cta_text: 'Get started free' }); load() }
  return (
    <div className="space-y-6">
      <Panel title="New landing page">
        <form onSubmit={create} className="space-y-2">
          <input className={input} placeholder="Headline" value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} required />
          <input className={input} placeholder="Subheadline" value={f.subhead} onChange={(e) => setF({ ...f, subhead: e.target.value })} />
          <input className={input} placeholder="CTA text" value={f.cta_text} onChange={(e) => setF({ ...f, cta_text: e.target.value })} />
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create page</button>
        </form>
      </Panel>
      <Panel title="Landing pages">
        {list.length === 0 ? (
          <EducationalEmpty icon={LayoutTemplate} title="Send traffic to a page that converts"
            body="Spin up a branded landing page with your own headline and CTA, then share the link in ads, posts, or DMs. Every view and signup is tracked and attributed back to you automatically." />
        ) : <div className="divide-y divide-hairline">{list.map((p) => (
          <div key={p.id} className="flex items-center gap-3 py-2.5">
            <span className="flex-1 truncate text-sm text-ink">{p.headline}</span>
            <span className="text-xs text-muted">{p.view_count} views</span>
            <button onClick={() => { navigator.clipboard.writeText(`${origin}/l/${p.slug}`); toast.success('Link copied') }} className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Copy className="h-3.5 w-3.5" /></button>
            <a href={`/l/${p.slug}`} target="_blank" rel="noreferrer" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
        ))}</div>}
      </Panel>
    </div>
  )
}

// ── Spend ──
interface SpendRow { id: string; platform: string; amount_cents: number; spend_date: string; note: string | null }
function Spend() {
  const [list, setList] = useState<SpendRow[]>([]); const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  const [f, setF] = useState({ platform: 'meta', amount: '', campaign_id: '', spend_date: new Date().toISOString().slice(0, 10) })
  const load = useCallback(async () => {
    const [s, c] = await Promise.all([fetch('/api/partner/spend').then((r) => r.json()), fetch('/api/partner/campaigns').then((r) => r.json())])
    setList(s.spend || []); setCampaigns(c.campaigns || [])
  }, [])
  useEffect(() => { load() }, [load])
  async function add(e: React.FormEvent) { e.preventDefault(); const r = await fetch('/api/partner/spend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: f.platform, amount_cents: Math.round(Number(f.amount) * 100), campaign_id: f.campaign_id || null, spend_date: f.spend_date }) }); if (!r.ok) return toast.error('Failed'); toast.success('Spend logged'); setF({ ...f, amount: '' }); load() }
  return (
    <div className="space-y-6">
      <Panel title="Log ad spend">
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <select className={`${input} w-28`} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{['meta', 'google', 'tiktok', 'linkedin', 'other'].map((p) => <option key={p}>{p}</option>)}</select>
          <input className={`${input} w-28`} placeholder="Amount $" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
          <select className={`${input} w-40`} value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">No campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="date" className={`${input} w-36`} value={f.spend_date} onChange={(e) => setF({ ...f, spend_date: e.target.value })} />
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Add</button>
        </form>
        <p className="mt-2 text-xs text-muted">Manual now. Meta / Google / TikTok / LinkedIn syncs plug in here later — no re-entry.</p>
      </Panel>
      <Panel title="Spend log">
        {list.length === 0 ? (
          <EducationalEmpty icon={DollarSign} title="Track spend to unlock true ROI"
            body="Log what you spend on ads by platform and campaign. Scalix pairs it with the customers each campaign produced to compute your real CAC, ROI, and payback — no spreadsheets." />
        ) : <div className="divide-y divide-hairline">{list.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="w-20 capitalize text-subtle">{r.platform}</span>
            <span className="flex-1 text-muted">{r.spend_date}</span>
            <span className="font-medium text-ink">{money(r.amount_cents)}</span>
          </div>
        ))}</div>}
      </Panel>
    </div>
  )
}
