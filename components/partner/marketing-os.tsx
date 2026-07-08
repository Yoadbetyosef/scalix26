'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { StatCard, Panel, EmptyRow, money } from '@/components/partner/ui'
import { MarketingLibrary } from '@/components/partner/marketing-library'
import { RoiCalculator } from '@/components/partner/roi-calculator'
import { CreativeStudio } from '@/components/partner/creative-studio'
import { LandingBuilder } from '@/components/partner/landing-builder'
import { MarketingIntelPanel } from '@/components/partner/marketing-intel-panel'
import { type Tab, type Nav, input, label, fmtDate, STATUS_STYLE, EducationalEmpty, Modal, Metric, CHANNELS } from '@/components/partner/marketing-ui'
import {
  Megaphone, Palette, LayoutTemplate, DollarSign, BarChart3, FolderOpen, Plus, Pencil, Pause, Play, Archive,
  Link2, Info, ArrowRight, RotateCcw, MousePointerClick,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// Honest banner: what's manual vs. what Scalix attributes automatically.
function ModeBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-accent/20 bg-accent/[0.04] px-3.5 py-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
      <div className="text-subtle">
        <span className="font-medium text-ink">Manual tracking mode.</span> Ad-platform integrations aren&apos;t connected yet — so <span className="text-ink">budget &amp; spend are entered by you</span>. Clicks, demos, trials, paid customers, commission &amp; ROI are tracked automatically by Scalix attribution.
      </div>
    </div>
  )
}

export function MarketingOS() {
  const [tab, setTab] = useState<Tab>('performance')
  const [focusCampaign, setFocusCampaign] = useState<string | undefined>()
  const nav: Nav = { go: (t, campaignId) => { setFocusCampaign(campaignId); setTab(t) } }
  const tabs: { key: Tab; label: string; icon: LucideIcon }[] = [
    { key: 'performance', label: 'Performance', icon: BarChart3 },
    { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
    { key: 'creatives', label: 'Creative Studio', icon: Palette },
    { key: 'landing', label: 'Landing Pages', icon: LayoutTemplate },
    { key: 'spend', label: 'Ad Spend', icon: DollarSign },
    { key: 'assets', label: 'Revenue Toolkit', icon: FolderOpen },
  ]
  return (
    <div>
      <div className="mb-5 -mx-1 flex gap-1 overflow-x-auto border-b border-hairline px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === t.key ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'performance' && <Performance nav={nav} />}
      {tab === 'campaigns' && <Campaigns nav={nav} />}
      {tab === 'creatives' && <CreativeStudio focusCampaign={focusCampaign} />}
      {tab === 'landing' && <LandingBuilder focusCampaign={focusCampaign} />}
      {tab === 'spend' && <Spend focusCampaign={focusCampaign} />}
      {tab === 'assets' && <div className="space-y-6"><RoiCalculator /><MarketingLibrary /></div>}
    </div>
  )
}

// ── Performance ──
interface CampaignPerf {
  campaign_id: string; name: string; channel: string | null; status: string; clicks: number; signups: number; trials: number; paid: number
  demos: number; commission_cents: number; spend_cents: number; cac_cents: number | null; roi_pct: number | null
}
interface CreativePerf { creative_id: string; title: string; type: string; status: string; clicks: number; signups: number; paid: number; commission_cents: number }
interface FunnelData { spend_cents: number; clicks: number; lp_views: number; demo_starts: number; trials: number; paid: number; commission_cents: number }
interface PerfResp { campaigns: CampaignPerf[]; creatives: CreativePerf[]; funnel: FunnelData; overall: { spend_cents: number; commission_cents: number; paid: number; cac_cents: number | null; roi_pct: number | null } }

function Performance({ nav }: { nav: Nav }) {
  const [d, setD] = useState<PerfResp | null>(null)
  useEffect(() => { fetch('/api/partner/marketing/performance').then((r) => r.json()).then(setD) }, [])
  if (!d) return <EmptyRow>Loading…</EmptyRow>
  const o = d.overall, f = d.funnel
  const hasData = d.campaigns.length > 0 || f.clicks > 0 || f.spend_cents > 0

  if (!hasData) {
    const steps = [
      { n: 1, t: 'Create a campaign', d: 'Group everything behind one initiative.', tab: 'campaigns' as Tab, icon: Megaphone },
      { n: 2, t: 'Add a creative', d: 'Ad copy, image, video or script.', tab: 'creatives' as Tab, icon: Palette },
      { n: 3, t: 'Build a landing page', d: 'A tracked place to send traffic.', tab: 'landing' as Tab, icon: LayoutTemplate },
      { n: 4, t: 'Add your ad spend', d: 'So Scalix computes CAC, ROI & payback.', tab: 'spend' as Tab, icon: DollarSign },
      { n: 5, t: 'Send traffic', d: 'Share your link in ads, posts, DMs.', tab: null, icon: MousePointerClick },
      { n: 6, t: 'Track demos → trials → paid', d: 'Attribution fills this in automatically.', tab: null, icon: BarChart3 },
    ]
    return (
      <div className="space-y-4">
        <MarketingIntelPanel nav={nav} />
        <div className="rounded-2xl border border-hairline bg-surface p-5 shadow-e1 sm:p-6">
          <h3 className="text-lg font-semibold text-ink">Your marketing command center</h3>
          <p className="mt-1 max-w-xl text-sm text-subtle">Every customer you drive is traced from creative → click → demo → trial → paid. Here&apos;s the path to your first attributed customer:</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((s) => (
              <button key={s.n} disabled={!s.tab} onClick={() => s.tab && nav.go(s.tab)}
                className={`flex items-start gap-3 rounded-xl border border-hairline bg-canvas p-3 text-left transition-colors ${s.tab ? 'hover:border-accent/40' : 'cursor-default opacity-90'}`}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent-strong">{s.n}</span>
                <span><span className="flex items-center gap-1.5 text-sm font-medium text-ink"><s.icon className="h-3.5 w-3.5 text-subtle" />{s.t}</span><span className="mt-0.5 block text-xs text-subtle">{s.d}</span></span>
              </button>
            ))}
          </div>
          <button onClick={() => nav.go('campaigns')} className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white">Start — create a campaign <ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    )
  }

  const stages = [
    { label: 'Ad spend', value: money(f.spend_cents), note: 'manual' as const },
    { label: 'Clicks', value: String(f.clicks), note: 'auto' as const },
    { label: 'LP views', value: String(f.lp_views), note: 'auto' as const },
    { label: 'Demo starts', value: String(f.demo_starts), note: 'auto' as const },
    { label: 'Trials', value: String(f.trials), note: 'auto' as const },
    { label: 'Paid', value: String(f.paid), note: 'auto' as const },
    { label: 'Commission', value: money(f.commission_cents), note: 'auto' as const },
  ]
  return (
    <div className="space-y-5">
      <MarketingIntelPanel nav={nav} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ad Spend" value={money(o.spend_cents)} hint="Entered manually" />
        <StatCard label="Commission" value={money(o.commission_cents)} accent hint="From paid customers" />
        <StatCard label="Blended CAC" value={o.cac_cents != null ? money(o.cac_cents) : '—'} hint="Spend ÷ paid" />
        <StatCard label="ROI" value={o.roi_pct != null ? `${o.roi_pct}%` : '—'} hint="Commission vs spend" />
      </div>

      <Panel title="Full-funnel">
        <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
          {stages.map((s, i) => (
            <div key={s.label} className="flex shrink-0 items-center gap-2">
              <div className="min-w-[88px] rounded-xl border border-hairline bg-canvas px-3 py-2.5">
                <div className="text-[10px] font-medium uppercase tracking-[0.04em] text-muted">{s.label}</div>
                <div className="text-base font-semibold tabular-nums text-ink">{s.value}</div>
                <div className={`text-[10px] ${s.note === 'auto' ? 'text-green-600' : 'text-amber-600'}`}>{s.note === 'auto' ? 'auto' : 'manual'}</div>
              </div>
              {i < stages.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted" />}
            </div>
          ))}
          <div className="flex shrink-0 items-center gap-2">
            <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
            <div className="min-w-[88px] rounded-xl border border-accent/30 bg-accent/[0.05] px-3 py-2.5">
              <div className="text-[10px] font-medium uppercase tracking-[0.04em] text-muted">ROI</div>
              <div className={`text-base font-semibold tabular-nums ${(o.roi_pct ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{o.roi_pct != null ? `${o.roi_pct}%` : '—'}</div>
              <div className="text-[10px] text-subtle">blended</div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Campaign performance">
        {d.campaigns.length === 0 ? (
          <EducationalEmpty icon={BarChart3} title="Your ROI shows up here" body="Create a campaign and start driving clicks — this table ranks every campaign by the customers and commission it produced." cta={<button onClick={() => nav.go('campaigns')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create a campaign</button>} />
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-hairline text-left text-xs uppercase text-muted">
              <th className="py-2 pr-3">Campaign</th><th className="py-2 pr-3 text-right">Clicks</th><th className="py-2 pr-3 text-right">Paid</th>
              <th className="py-2 pr-3 text-right">Spend</th><th className="py-2 pr-3 text-right">CAC</th><th className="py-2 pr-3 text-right">Commission</th><th className="py-2 text-right">ROI</th>
            </tr></thead>
            <tbody>{d.campaigns.map((c) => (
              <tr key={c.campaign_id} className="border-b border-hairline/60">
                <td className="max-w-[160px] truncate py-2 pr-3 text-ink">{c.name}{c.channel && <span className="ml-1 text-xs capitalize text-muted">· {c.channel}</span>}</td>
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
          <EducationalEmpty icon={Palette} title="Find your winning message" body="Add creatives in the Creative Studio. As they drive clicks and customers, the best performers rise to the top here." cta={<button onClick={() => nav.go('creatives')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Open Creative Studio</button>} />
        ) : (
          <div className="divide-y divide-hairline">{d.creatives.slice(0, 10).map((c) => (
            <div key={c.creative_id} className="flex items-center gap-3 py-2.5">
              <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-xs capitalize text-subtle">{c.type.replace(/_/g, ' ')}</span>
              <span className="flex-1 truncate text-sm text-ink">{c.title}</span>
              <span className="shrink-0 text-xs text-muted">{c.paid} paid · {money(c.commission_cents)}</span>
            </div>
          ))}</div>
        )}
      </Panel>
    </div>
  )
}

// ── Campaigns (manager) ──
interface CampaignRow {
  campaign_id: string; name: string; channel: string | null; status: string; budget_cents: number | null; created_at: string
  clicks: number; signups: number; trials: number; paid: number; demos: number; creatives: number; landing_pages: number; links: number
  commission_cents: number; spend_cents: number; cac_cents: number | null; roi_pct: number | null
}

function Campaigns({ nav }: { nav: Nav }) {
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
    if (!f.name.trim()) return toast.error('Give the campaign a name')
    const r = await fetch('/api/partner/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name.trim(), channel: f.channel, budget_cents: f.budget ? Math.round(Number(f.budget) * 100) : null }) })
    if (!r.ok) return toast.error('Could not create campaign')
    toast.success('Campaign created'); setF({ name: '', channel: 'meta', budget: '' }); setShowCreate(false); load()
  }
  async function patch(id: string, body: Record<string, unknown>, msg?: string) {
    const r = await fetch('/api/partner/campaigns', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    if (!r.ok) return toast.error('Could not update campaign')
    if (msg) toast.success(msg); load()
  }
  async function copyLink(c: CampaignRow) {
    const r = await fetch('/api/partner/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: `Campaign: ${c.name}`, campaign_id: c.campaign_id }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.link?.code) return toast.error('Could not create tracking link')
    navigator.clipboard.writeText(`${window.location.origin}/r/${j.link.code}`); toast.success('Tracking link copied'); load()
  }

  const filters = ['All', 'Active', 'Paused', 'Archived']
  const shown = rows.filter((r) => filter === 'All' ? r.status !== 'archived' : r.status === filter.toLowerCase())
  const archivedCount = rows.filter((r) => r.status === 'archived').length

  const createForm = (
    <Panel title="New campaign">
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input className={`${input} min-w-[160px] flex-1`} placeholder="e.g. Meta — Locksmiths, Q3" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select className={`${input} w-32 capitalize`} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}</select>
        <input className={`${input} w-28`} placeholder="Budget $" inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
        <button className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create</button>
      </form>
    </Panel>
  )

  return (
    <div className="space-y-5">
      <MarketingIntelPanel nav={nav} />
      <ModeBanner />
      {loading ? <EmptyRow>Loading…</EmptyRow> : rows.length === 0 ? (
        <>
          <EducationalEmpty icon={Megaphone} title="Run your outreach as campaigns, not guesswork" body="A campaign groups the creatives, landing pages, links, and ad spend behind one initiative — so Scalix attributes every click, demo, trial, and paying customer back to it, and shows you the real ROI." cta={<button onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create your first campaign</button>} />
          {showCreate && createForm}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {filters.map((s) => (s === 'Archived' && archivedCount === 0) ? null : (
                <button key={s} onClick={() => setFilter(s)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === s ? 'bg-ink text-white' : 'bg-sunken text-subtle hover:text-ink'}`}>{s}</button>
              ))}
            </div>
            <button onClick={() => setShowCreate((v) => !v)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> New campaign</button>
          </div>
          {showCreate && createForm}

          {shown.length === 0 ? (
            <EducationalEmpty icon={Megaphone} title={`No ${filter.toLowerCase()} campaigns`} body={filter === 'Active' ? 'Nothing running right now. Create a campaign or resume a paused one to start driving attributed traffic.' : 'Switch filters to see your other campaigns.'} />
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {shown.map((c) => (
                <div key={c.campaign_id} className="flex flex-col rounded-2xl border border-hairline bg-surface p-4 shadow-e1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">{c.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        {c.channel && <span className="rounded-full bg-sunken px-2 py-0.5 font-medium capitalize text-subtle">{c.channel}</span>}
                        <span>{fmtDate(c.created_at)}</span>
                        <span>· {c.links}L · {c.creatives}C · {c.landing_pages}LP</span>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${STATUS_STYLE[c.status] || STATUS_STYLE.draft}`}>{c.status}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-x-3 gap-y-3 border-t border-hairline pt-3">
                    <Metric label="Budget" value={c.budget_cents != null ? money(c.budget_cents) : '—'} note="manual" />
                    <Metric label="Spend" value={money(c.spend_cents)} note="manual" />
                    <Metric label="Clicks" value={String(c.clicks)} note="auto" />
                    <Metric label="Demos" value={String(c.demos)} note="auto" />
                    <Metric label="Trials" value={String(c.trials)} note="auto" />
                    <Metric label="Customers" value={String(c.paid)} note="auto" />
                    <Metric label="Comm." value={money(c.commission_cents)} note="auto" tone={c.commission_cents > 0 ? 'good' : undefined} />
                    <Metric label="ROI" value={c.roi_pct != null ? `${c.roi_pct}%` : '—'} note="auto" tone={c.roi_pct == null ? undefined : c.roi_pct >= 0 ? 'good' : 'bad'} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-hairline pt-3">
                    <button onClick={() => nav.go('creatives', c.campaign_id)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><Palette className="h-3.5 w-3.5" /><span className="hidden sm:inline"> Creative</span></button>
                    <button onClick={() => nav.go('landing', c.campaign_id)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><LayoutTemplate className="h-3.5 w-3.5" /><span className="hidden sm:inline"> Page</span></button>
                    <button onClick={() => nav.go('spend', c.campaign_id)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><DollarSign className="h-3.5 w-3.5" /><span className="hidden sm:inline"> Spend</span></button>
                    <button onClick={() => copyLink(c)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><Link2 className="h-3.5 w-3.5" /><span className="hidden sm:inline"> Link</span></button>
                    <div className="ml-auto flex items-center gap-1">
                      <button onClick={() => setEdit(c)} title="Edit" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                      {c.status === 'active' ? (
                        <button onClick={() => patch(c.campaign_id, { status: 'paused' }, 'Campaign paused')} title="Pause" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Pause className="h-3.5 w-3.5" /></button>
                      ) : c.status !== 'archived' ? (
                        <button onClick={() => patch(c.campaign_id, { status: 'active' }, 'Campaign resumed')} title="Resume" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Play className="h-3.5 w-3.5" /></button>
                      ) : null}
                      {c.status !== 'archived' ? (
                        <button onClick={() => patch(c.campaign_id, { status: 'archived' }, 'Campaign archived')} title="Archive" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Archive className="h-3.5 w-3.5" /></button>
                      ) : (
                        <button onClick={() => patch(c.campaign_id, { status: 'paused' }, 'Campaign restored')} title="Restore" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><RotateCcw className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
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
    <Modal title="Edit campaign" onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return toast.error('Name is required'); onSave({ name: name.trim(), channel, budget_cents: budget ? Math.round(Number(budget) * 100) : null }) }}>
        <div><label className={label}>Name</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className={label}>Channel</label><select className={`${input} capitalize`} value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}</select></div>
        <div><label className={label}>Budget ($)</label><input className={input} inputMode="decimal" placeholder="Optional" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">Cancel</button>
          <button type="submit" className="h-10 flex-1 rounded-lg bg-ink text-sm font-medium text-white">Save changes</button>
        </div>
      </form>
    </Modal>
  )
}

// ── Ad Spend ──
interface SpendRow { id: string; platform: string; amount_cents: number; spend_date: string; note: string | null; campaign_id: string | null }
function Spend({ focusCampaign }: { focusCampaign?: string }) {
  const [list, setList] = useState<SpendRow[]>([])
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  const [perf, setPerf] = useState<CampaignPerf[]>([])
  const [f, setF] = useState({ platform: 'meta', amount: '', campaign_id: focusCampaign || '', spend_date: new Date().toISOString().slice(0, 10), note: '' })

  const load = useCallback(async () => {
    const [s, c, p] = await Promise.all([
      fetch('/api/partner/spend').then((r) => r.json()),
      fetch('/api/partner/campaigns').then((r) => r.json()),
      fetch('/api/partner/marketing/performance').then((r) => r.json()),
    ])
    setList(s.spend || []); setCampaigns((c.campaigns || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name }))); setPerf(p.campaigns || [])
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (focusCampaign) setF((p) => ({ ...p, campaign_id: focusCampaign })) }, [focusCampaign])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!f.amount || Number(f.amount) <= 0) return toast.error('Enter an amount')
    const r = await fetch('/api/partner/spend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: f.platform, amount_cents: Math.round(Number(f.amount) * 100), campaign_id: f.campaign_id || null, spend_date: f.spend_date, note: f.note || null }) })
    if (!r.ok) return toast.error('Could not log spend')
    toast.success('Spend logged'); setF({ ...f, amount: '', note: '' }); load()
  }
  async function del(id: string) { await fetch(`/api/partner/spend?id=${id}`, { method: 'DELETE' }); load() }

  const cName = (id: string | null) => id ? campaigns.find((c) => c.id === id)?.name : null
  const cPerf = (id: string | null) => id ? perf.find((p) => p.campaign_id === id) : null
  const total = list.reduce((s, r) => s + r.amount_cents, 0)
  const monthPrefix = new Date().toISOString().slice(0, 7)
  const thisMonth = list.filter((r) => (r.spend_date || '').startsWith(monthPrefix)).reduce((s, r) => s + r.amount_cents, 0)
  const bestRoi = perf.filter((p) => p.roi_pct != null && p.spend_cents > 0).sort((a, b) => (b.roi_pct! - a.roi_pct!))[0]
  const byChannel: Record<string, number> = {}
  for (const r of list) byChannel[r.platform] = (byChannel[r.platform] || 0) + r.amount_cents
  const topChannel = Object.entries(byChannel).sort((a, b) => b[1] - a[1])[0]

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-accent/20 bg-accent/[0.04] px-3.5 py-3 text-sm text-subtle">
        <span className="font-medium text-ink">Track what you spend per channel</span> so Scalix computes your CAC, ROI, and payback against the customers each campaign produces. Manual for now — Meta, Google, TikTok &amp; LinkedIn syncs plug in here later with no re-entry.
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total spend" value={money(total)} />
        <StatCard label="This month" value={money(thisMonth)} />
        <StatCard label="Best ROI campaign" value={bestRoi ? `${bestRoi.roi_pct}%` : '—'} hint={bestRoi ? bestRoi.name : 'Needs spend + a paid customer'} />
        <StatCard label="Top spend channel" value={topChannel ? topChannel[0] : '—'} hint={topChannel ? money(topChannel[1]) : 'No spend yet'} />
      </div>

      <Panel title="Log ad spend">
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <select className={`${input} w-28 capitalize`} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{['meta', 'google', 'tiktok', 'linkedin', 'other'].map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}</select>
          <input className={`${input} w-28`} placeholder="Amount $" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <select className={`${input} w-44`} value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">No campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="date" className={`${input} w-36`} value={f.spend_date} onChange={(e) => setF({ ...f, spend_date: e.target.value })} />
          <input className={`${input} min-w-[140px] flex-1`} placeholder="Note (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Add</button>
        </form>
      </Panel>

      <Panel title="Spend log">
        {list.length === 0 ? (
          <EducationalEmpty icon={DollarSign} title="Track spend to unlock true ROI" body="Log what you spend on ads by platform and campaign. Scalix pairs it with the customers each campaign produced to compute real CAC, ROI, and payback — no spreadsheets." />
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-hairline text-left text-xs uppercase text-muted">
              <th className="py-2 pr-3">Channel</th><th className="py-2 pr-3">Campaign</th><th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3 text-right">CAC</th><th className="py-2 pr-3 text-right">ROI</th><th className="py-2"></th>
            </tr></thead>
            <tbody>{list.map((r) => {
              const p = cPerf(r.campaign_id)
              return (
                <tr key={r.id} className="border-b border-hairline/60">
                  <td className="py-2 pr-3 capitalize text-ink">{r.platform}</td>
                  <td className="py-2 pr-3 text-subtle">{cName(r.campaign_id) || <span className="text-muted">—</span>}{r.note && <span className="block text-[11px] text-muted">{r.note}</span>}</td>
                  <td className="py-2 pr-3 text-muted">{r.spend_date}</td>
                  <td className="py-2 pr-3 text-right font-medium text-ink">{money(r.amount_cents)}</td>
                  <td className="py-2 pr-3 text-right text-subtle">{p?.cac_cents != null ? money(p.cac_cents) : '—'}</td>
                  <td className={`py-2 pr-3 text-right ${p?.roi_pct == null ? 'text-subtle' : p.roi_pct >= 0 ? 'text-green-700' : 'text-red-600'}`}>{p?.roi_pct != null ? `${p.roi_pct}%` : '—'}</td>
                  <td className="py-2 text-right"><button onClick={() => del(r.id)} className="text-muted hover:text-red-600" title="Delete">×</button></td>
                </tr>
              )
            })}</tbody>
          </table></div>
        )}
      </Panel>
    </div>
  )
}
