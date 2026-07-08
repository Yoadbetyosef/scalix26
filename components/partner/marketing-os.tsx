'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { StatCard, Panel, EmptyRow, money } from '@/components/partner/ui'
import { MarketingLibrary } from '@/components/partner/marketing-library'
import { RoiCalculator } from '@/components/partner/roi-calculator'
import {
  Megaphone, Palette, LayoutTemplate, DollarSign, BarChart3, FolderOpen, Plus, Copy, ExternalLink,
  Pencil, Pause, Play, Archive, X, Link2, MousePointerClick, Info, ArrowRight, Eye, RotateCcw, type LucideIcon,
} from 'lucide-react'

type Tab = 'performance' | 'campaigns' | 'creatives' | 'landing' | 'spend' | 'assets'
const input = 'h-9 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'
const textarea = 'w-full rounded-lg border border-hairline-strong p-2.5 text-sm outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-medium text-subtle'
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const CHANNELS = ['meta', 'google', 'tiktok', 'linkedin', 'organic', 'email', 'other']
const PLATFORMS = ['meta', 'google', 'tiktok', 'linkedin', 'youtube', 'other']
const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-50 text-green-700', published: 'bg-green-50 text-green-700', winner: 'bg-green-50 text-green-700',
  paused: 'bg-amber-50 text-amber-700', testing: 'bg-amber-50 text-amber-700',
  archived: 'bg-gray-100 text-gray-500', draft: 'bg-sunken text-subtle',
}

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

// Honest banner: be explicit about what's manual vs. what Scalix attributes automatically.
function ModeBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-accent/20 bg-accent/[0.04] px-4 py-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
      <div className="text-subtle">
        <span className="font-medium text-ink">Manual tracking mode.</span> Ad-platform integrations (Meta, Google, TikTok, LinkedIn) aren&apos;t connected yet — so <span className="text-ink">budget &amp; spend are entered by you</span>. Everything downstream — <span className="text-ink">clicks, demos, trials, paid customers, commission &amp; ROI</span> — is tracked automatically by Scalix attribution as real events happen.
      </div>
    </div>
  )
}

interface Nav { go: (tab: Tab, campaignId?: string) => void }

export function MarketingOS() {
  const [tab, setTab] = useState<Tab>('performance')
  const [focusCampaign, setFocusCampaign] = useState<string | undefined>()
  const go = (t: Tab, campaignId?: string) => { setFocusCampaign(campaignId); setTab(t) }
  const nav: Nav = { go }
  const tabs: { key: Tab; label: string; icon: LucideIcon }[] = [
    { key: 'performance', label: 'Performance', icon: BarChart3 },
    { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
    { key: 'creatives', label: 'Creatives', icon: Palette },
    { key: 'landing', label: 'Landing Pages', icon: LayoutTemplate },
    { key: 'spend', label: 'Ad Spend', icon: DollarSign },
    { key: 'assets', label: 'Revenue Toolkit', icon: FolderOpen },
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
      {tab === 'performance' && <Performance nav={nav} />}
      {tab === 'campaigns' && <Campaigns nav={nav} />}
      {tab === 'creatives' && <Creatives focusCampaign={focusCampaign} />}
      {tab === 'landing' && <Landing focusCampaign={focusCampaign} />}
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
  const o = d.overall
  const f = d.funnel
  const hasData = d.campaigns.length > 0 || f.clicks > 0 || f.spend_cents > 0

  if (!hasData) {
    const steps = [
      { n: 1, t: 'Create a campaign', d: 'Group everything behind one initiative.', tab: 'campaigns' as Tab, icon: Megaphone },
      { n: 2, t: 'Add a creative', d: 'Ad copy, a script, an email — your message.', tab: 'creatives' as Tab, icon: Palette },
      { n: 3, t: 'Create a landing page or link', d: 'A tracked place to send traffic.', tab: 'landing' as Tab, icon: LayoutTemplate },
      { n: 4, t: 'Add your ad spend', d: 'So Scalix can compute CAC, ROI & payback.', tab: 'spend' as Tab, icon: DollarSign },
      { n: 5, t: 'Send traffic', d: 'Share your link in ads, posts, and DMs.', tab: null, icon: MousePointerClick },
      { n: 6, t: 'Track demos → trials → paid', d: 'Attribution fills this in automatically.', tab: null, icon: BarChart3 },
    ]
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-hairline bg-surface p-6 shadow-e1">
          <h3 className="text-lg font-semibold text-ink">Your marketing command center</h3>
          <p className="mt-1 max-w-xl text-sm text-subtle">Every customer you drive is traced from creative → click → demo → trial → paid, so you can see exactly what works and what to improve. Here&apos;s the path to your first attributed customer:</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((s) => (
              <button key={s.n} disabled={!s.tab} onClick={() => s.tab && nav.go(s.tab)}
                className={`flex items-start gap-3 rounded-xl border border-hairline bg-canvas p-3 text-left transition-colors ${s.tab ? 'hover:border-accent/40' : 'cursor-default opacity-90'}`}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent-strong">{s.n}</span>
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink"><s.icon className="h-3.5 w-3.5 text-subtle" />{s.t}</span>
                  <span className="mt-0.5 block text-xs text-subtle">{s.d}</span>
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => nav.go('campaigns')} className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white">Start — create a campaign <ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    )
  }

  const stages = [
    { label: 'Ad spend', value: money(f.spend_cents), note: 'manual' },
    { label: 'Clicks', value: String(f.clicks), note: 'auto' },
    { label: 'LP views', value: String(f.lp_views), note: 'auto' },
    { label: 'Demo starts', value: String(f.demo_starts), note: 'auto' },
    { label: 'Trials', value: String(f.trials), note: 'auto' },
    { label: 'Paid', value: String(f.paid), note: 'auto' },
    { label: 'Commission', value: money(f.commission_cents), note: 'auto' },
  ]
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ad Spend" value={money(o.spend_cents)} hint="Entered manually" />
        <StatCard label="Commission" value={money(o.commission_cents)} accent hint="From paid customers" />
        <StatCard label="Blended CAC" value={o.cac_cents != null ? money(o.cac_cents) : '—'} hint="Spend ÷ paid" />
        <StatCard label="ROI" value={o.roi_pct != null ? `${o.roi_pct}%` : '—'} hint="Commission vs spend" />
      </div>

      <Panel title="Full-funnel">
        <div className="flex flex-wrap items-stretch gap-2">
          {stages.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              <div className="min-w-[92px] rounded-xl border border-hairline bg-canvas px-3 py-2.5">
                <div className="text-[10px] font-medium uppercase tracking-[0.04em] text-muted">{s.label}</div>
                <div className="text-base font-semibold tabular-nums text-ink">{s.value}</div>
                <div className={`text-[10px] ${s.note === 'auto' ? 'text-green-600' : 'text-amber-600'}`}>{s.note === 'auto' ? 'auto-tracked' : 'manual'}</div>
              </div>
              {i < stages.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted" />}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
            <div className="min-w-[92px] rounded-xl border border-accent/30 bg-accent/[0.05] px-3 py-2.5">
              <div className="text-[10px] font-medium uppercase tracking-[0.04em] text-muted">ROI</div>
              <div className={`text-base font-semibold tabular-nums ${(o.roi_pct ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{o.roi_pct != null ? `${o.roi_pct}%` : '—'}</div>
              <div className="text-[10px] text-subtle">blended</div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Campaign performance">
        {d.campaigns.length === 0 ? (
          <EducationalEmpty icon={BarChart3} title="Your ROI shows up here" body="Create a campaign and start driving clicks — this table ranks every campaign by the customers and commission it produced, with live CAC and ROI." cta={<button onClick={() => nav.go('campaigns')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create a campaign</button>} />
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-hairline text-left text-xs uppercase text-muted">
              <th className="py-2 pr-3">Campaign</th><th className="py-2 pr-3 text-right">Clicks</th><th className="py-2 pr-3 text-right">Paid</th>
              <th className="py-2 pr-3 text-right">Spend</th><th className="py-2 pr-3 text-right">CAC</th><th className="py-2 pr-3 text-right">Commission</th><th className="py-2 text-right">ROI</th>
            </tr></thead>
            <tbody>{d.campaigns.map((c) => (
              <tr key={c.campaign_id} className="border-b border-hairline/60">
                <td className="py-2 pr-3 text-ink">{c.name}{c.channel && <span className="ml-1 text-xs capitalize text-muted">· {c.channel}</span>}</td>
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
          <EducationalEmpty icon={Palette} title="Find your winning message" body="Add ad copy, scripts, and templates in the Creatives tab. As they drive clicks and customers, the best performers rise to the top here." cta={<button onClick={() => nav.go('creatives')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Add a creative</button>} />
        ) : (
          <div className="divide-y divide-hairline">{d.creatives.slice(0, 10).map((c) => (
            <div key={c.creative_id} className="flex items-center gap-3 py-2.5">
              <span className="rounded-full bg-sunken px-2 py-0.5 text-xs capitalize text-subtle">{c.type.replace(/_/g, ' ')}</span>
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
interface CampaignRow {
  campaign_id: string; name: string; channel: string | null; status: string; budget_cents: number | null; created_at: string
  clicks: number; signups: number; trials: number; paid: number; demos: number; creatives: number; landing_pages: number; links: number
  commission_cents: number; spend_cents: number; cac_cents: number | null; roi_pct: number | null
}

function CampaignMetric({ label: l, value, tone, note }: { label: string; value: string; tone?: 'good' | 'bad'; note?: 'manual' | 'auto' }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.04em] text-muted">{l}{note && <span className={`inline-block h-1 w-1 rounded-full ${note === 'auto' ? 'bg-green-500' : 'bg-amber-500'}`} />}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-600' : 'text-ink'}`}>{value}</div>
    </div>
  )
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
    navigator.clipboard.writeText(`${window.location.origin}/r/${j.link.code}`)
    toast.success('Tracking link copied'); load()
  }

  const filters = ['All', 'Active', 'Paused', 'Archived']
  const shown = rows.filter((r) => filter === 'All' ? r.status !== 'archived' : r.status === filter.toLowerCase())
  const archivedCount = rows.filter((r) => r.status === 'archived').length

  const createForm = (
    <Panel title="New campaign">
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input className={`${input} flex-1 min-w-[180px]`} placeholder="e.g. Meta — Locksmiths, Q3" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select className={`${input} w-32 capitalize`} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}</select>
        <input className={`${input} w-32`} placeholder="Budget $" inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
        <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create</button>
      </form>
    </Panel>
  )

  return (
    <div className="space-y-5">
      <ModeBanner />
      {loading ? <EmptyRow>Loading…</EmptyRow> : rows.length === 0 ? (
        <>
          <EducationalEmpty icon={Megaphone}
            title="Run your outreach as campaigns, not guesswork"
            body="A campaign groups the creatives, landing pages, links, and ad spend behind one initiative — so Scalix can attribute every click, demo, trial, and paying customer back to it, and show you the real ROI."
            cta={<button onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create your first campaign</button>} />
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
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        {c.channel && <span className="rounded-full bg-sunken px-2 py-0.5 font-medium capitalize text-subtle">{c.channel}</span>}
                        <span>Created {fmtDate(c.created_at)}</span>
                        <span>· {c.links} {c.links === 1 ? 'link' : 'links'} · {c.creatives} {c.creatives === 1 ? 'creative' : 'creatives'} · {c.landing_pages} LP</span>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[c.status] || STATUS_STYLE.draft}`}>{c.status}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-x-3 gap-y-3 border-t border-hairline pt-3">
                    <CampaignMetric label="Budget" value={c.budget_cents != null ? money(c.budget_cents) : '—'} note="manual" />
                    <CampaignMetric label="Spend" value={money(c.spend_cents)} note="manual" />
                    <CampaignMetric label="Clicks" value={String(c.clicks)} note="auto" />
                    <CampaignMetric label="Demos" value={String(c.demos)} note="auto" />
                    <CampaignMetric label="Trials" value={String(c.trials)} note="auto" />
                    <CampaignMetric label="Customers" value={String(c.paid)} note="auto" />
                    <CampaignMetric label="Commission" value={money(c.commission_cents)} note="auto" tone={c.commission_cents > 0 ? 'good' : undefined} />
                    <CampaignMetric label="ROI" value={c.roi_pct != null ? `${c.roi_pct}%` : '—'} note="auto" tone={c.roi_pct == null ? undefined : c.roi_pct >= 0 ? 'good' : 'bad'} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-hairline pt-3">
                    <button onClick={() => nav.go('creatives', c.campaign_id)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><Palette className="h-3.5 w-3.5" /> Add creative</button>
                    <button onClick={() => nav.go('landing', c.campaign_id)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><LayoutTemplate className="h-3.5 w-3.5" /> Landing page</button>
                    <button onClick={() => nav.go('spend', c.campaign_id)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><DollarSign className="h-3.5 w-3.5" /> Add spend</button>
                    <button onClick={() => copyLink(c)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><Link2 className="h-3.5 w-3.5" /> Copy link</button>
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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-md flex-col rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <div className="font-semibold text-ink">{title}</div>
          <button onClick={onClose} className="rounded-full bg-sunken p-1.5 text-subtle"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
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

// ── Creatives ──
const CREATIVE_TYPES: { key: string; label: string }[] = [
  { key: 'ad_copy', label: 'Ad Copy' }, { key: 'image', label: 'Image' }, { key: 'video', label: 'Video' },
  { key: 'email', label: 'Email' }, { key: 'sms', label: 'SMS' }, { key: 'call_script', label: 'Script' },
]
const typeLabel = (t: string) => CREATIVE_TYPES.find((x) => x.key === t)?.label || t.replace(/_/g, ' ')
interface Creative { id: string; type: string; title: string; body: string | null; asset_url: string | null; status: string; campaign_id: string | null; tags: string[]; created_at: string }

function creativeData(c: { body: string | null }): Record<string, string> {
  if (!c.body) return {}
  try { const o = JSON.parse(c.body); return o && typeof o === 'object' && !Array.isArray(o) ? o : { text: String(c.body) } }
  catch { return { text: c.body } }
}
function creativePreview(c: Creative): string {
  const d = creativeData(c)
  if (d.text) return d.text
  switch (c.type) {
    case 'ad_copy': return [d.headline && `HEADLINE\n${d.headline}`, d.primary && `PRIMARY TEXT\n${d.primary}`, d.cta && `CTA: ${d.cta}`, d.platform && `Platform: ${d.platform}`].filter(Boolean).join('\n\n')
    case 'image': return [c.asset_url && `Image: ${c.asset_url}`, d.notes && `Notes:\n${d.notes}`, d.platform && `Platform: ${d.platform}`].filter(Boolean).join('\n\n')
    case 'video': return [c.asset_url && `Video: ${c.asset_url}`, d.script && `SCRIPT\n${d.script}`, d.platform && `Platform: ${d.platform}`].filter(Boolean).join('\n\n')
    case 'email': return d.body || ''
    case 'sms': return d.body || ''
    case 'call_script': return [d.script, d.useCase && `\nUse case: ${d.useCase}`].filter(Boolean).join('\n')
    default: return d.body || d.text || ''
  }
}

function Creatives({ focusCampaign }: { focusCampaign?: string }) {
  const [mine, setMine] = useState<Creative[]>([])
  const [official, setOfficial] = useState<Creative[]>([])
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; creative?: Creative } | null>(null)
  const [preview, setPreview] = useState<Creative | null>(null)

  const load = useCallback(async () => {
    const [j, c] = await Promise.all([fetch('/api/partner/creatives').then((r) => r.json()), fetch('/api/partner/campaigns').then((r) => r.json())])
    setMine(j.mine || []); setOfficial(j.official || []); setCampaigns((c.campaigns || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })))
  }, [])
  useEffect(() => { load() }, [load])
  const cName = (id: string | null) => id ? campaigns.find((c) => c.id === id)?.name : null

  async function setStatus(id: string, status: string) { await fetch('/api/partner/creatives', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); load() }
  async function clone(id: string) { const r = await fetch('/api/partner/creatives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cloneFrom: id }) }); if (!r.ok) return toast.error('Failed'); toast.success('Cloned to your library'); load() }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-subtle">Build the messages you run — each connects to a campaign so its clicks and customers are attributed.</p>
        <button onClick={() => setEditor({ mode: 'create' })} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> New creative</button>
      </div>

      {mine.length === 0 ? (
        <EducationalEmpty icon={Palette} title="Build your creative library" body="Save the ad copy, images, videos, scripts, emails, and texts you actually use. Connect each to a campaign, mark winners, and clone a proven asset from the official library to start fast." cta={<button onClick={() => setEditor({ mode: 'create' })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create a creative</button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((c) => (
            <div key={c.id} className="flex flex-col rounded-2xl border border-hairline bg-surface p-4 shadow-e1">
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-subtle">{typeLabel(c.type)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[c.status] || STATUS_STYLE.draft}`}>{c.status}</span>
              </div>
              <div className="font-medium text-ink">{c.title}</div>
              {c.campaign_id ? (
                <div className="mt-0.5 text-[11px] text-muted">{cName(c.campaign_id) || 'Campaign'}</div>
              ) : (
                <button onClick={() => setEditor({ mode: 'edit', creative: c })} className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:underline"><Info className="h-3 w-3" /> Not connected — connect to a campaign</button>
              )}
              <div className="mt-1.5 line-clamp-2 flex-1 text-xs text-subtle">{creativePreview(c).replace(/\n+/g, ' ') || '—'}</div>
              <div className="mt-2 text-[11px] text-muted">Created {fmtDate(c.created_at)}</div>
              <div className="mt-3 flex items-center gap-1">
                <button onClick={() => setPreview(c)} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border border-hairline-strong text-xs font-medium text-subtle hover:text-ink"><Eye className="h-3.5 w-3.5" /> Preview</button>
                <button onClick={() => setEditor({ mode: 'edit', creative: c })} title="Edit" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>
                <select value={c.status} onChange={(e) => setStatus(c.id, e.target.value)} title="Status" className="h-8 rounded-md border border-hairline-strong px-1 text-xs text-subtle">
                  {['draft', 'testing', 'winner', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      <Panel title="Official Scalix library">
        {official.length === 0 ? <EmptyRow>Curated official creatives will appear here to clone into your library.</EmptyRow> : (
          <div className="divide-y divide-hairline">{official.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2.5">
              <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-subtle">{typeLabel(c.type)}</span>
              <span className="flex-1 truncate text-sm text-ink">{c.title}</span>
              <button onClick={() => setPreview(c)} className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink" title="Preview"><Eye className="h-3.5 w-3.5" /></button>
              <button onClick={() => clone(c.id)} className="inline-flex items-center gap-1 rounded-md border border-hairline-strong px-2 py-1 text-xs text-subtle hover:text-ink"><Copy className="h-3.5 w-3.5" /> Clone</button>
            </div>
          ))}</div>
        )}
      </Panel>

      {editor && <CreativeEditor mode={editor.mode} creative={editor.creative} campaigns={campaigns} defaultCampaign={focusCampaign} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load() }} />}
      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)}>
          <div className="mb-2 text-xs text-muted">{typeLabel(preview.type)}{preview.campaign_id && ` · ${cName(preview.campaign_id) || 'Campaign'}`}</div>
          {preview.type === 'image' && preview.asset_url && <img src={preview.asset_url} alt={preview.title} className="mb-3 w-full rounded-lg border border-hairline" />}
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{creativePreview(preview) || 'No content yet.'}</pre>
          <div className="mt-4 flex gap-2">
            <button onClick={() => { navigator.clipboard.writeText(creativePreview(preview)); toast.success('Copied') }} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink"><Copy className="h-4 w-4" /> Copy</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function CreativeEditor({ mode, creative, campaigns, defaultCampaign, onClose, onSaved }: { mode: 'create' | 'edit'; creative?: Creative; campaigns: { id: string; name: string }[]; defaultCampaign?: string; onClose: () => void; onSaved: () => void }) {
  const init = creative ? creativeData(creative) : {}
  const [type, setType] = useState(creative?.type || 'ad_copy')
  const [title, setTitle] = useState(creative?.title || '')
  const [campaignId, setCampaignId] = useState(creative?.campaign_id || defaultCampaign || '')
  const [assetUrl, setAssetUrl] = useState(creative?.asset_url || '')
  // structured fields
  const [headline, setHeadline] = useState(init.headline || '')
  const [primary, setPrimary] = useState(init.primary || '')
  const [cta, setCta] = useState(init.cta || '')
  const [platform, setPlatform] = useState(init.platform || 'meta')
  const [notes, setNotes] = useState(init.notes || '')
  const [script, setScript] = useState(init.script || '')
  const [body, setBody] = useState(init.body || init.text || '')
  const [useCase, setUseCase] = useState(init.useCase || '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return toast.error(type === 'email' ? 'Subject is required' : 'Title is required')
    let data: Record<string, string> = {}
    let asset: string | null = null
    if (type === 'ad_copy') { if (!headline.trim() && !primary.trim()) return toast.error('Add a headline or primary text'); data = { headline, primary, cta, platform } }
    else if (type === 'image') { if (!assetUrl.trim()) return toast.error('Add an image URL'); asset = assetUrl.trim(); data = { notes, platform } }
    else if (type === 'video') { if (!assetUrl.trim() && !script.trim()) return toast.error('Add a video URL or a script'); asset = assetUrl.trim() || null; data = { script, platform } }
    else if (type === 'email') { if (!body.trim()) return toast.error('Add the email body'); data = { body } }
    else if (type === 'sms') { if (!body.trim()) return toast.error('Add the message'); data = { body } }
    else if (type === 'call_script') { if (!script.trim()) return toast.error('Add the script'); data = { script, useCase } }

    const payload = { type, title: title.trim(), campaign_id: campaignId || null, asset_url: asset, body: JSON.stringify(data) }
    const r = mode === 'create'
      ? await fetch('/api/partner/creatives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/partner/creatives', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: creative!.id, ...payload }) })
    if (!r.ok) return toast.error('Could not save creative')
    toast.success(mode === 'create' ? 'Creative added' : 'Creative updated'); onSaved()
  }

  const campaignSelect = (
    <div><label className={label}>Campaign {!campaignId && <span className="text-amber-600">· connect for attribution</span>}</label>
      <select className={input} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
        <option value="">Not connected</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></div>
  )
  const platformSelect = (
    <div><label className={label}>Platform</label><select className={`${input} capitalize`} value={platform} onChange={(e) => setPlatform(e.target.value)}>{PLATFORMS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}</select></div>
  )

  return (
    <Modal title={mode === 'create' ? 'New creative' : 'Edit creative'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <div><label className={label}>Type</label>
          <div className="flex flex-wrap gap-1.5">
            {CREATIVE_TYPES.map((t) => (
              <button type="button" key={t.key} onClick={() => setType(t.key)} disabled={mode === 'edit'} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${type === t.key ? 'bg-ink text-white' : 'bg-sunken text-subtle hover:text-ink'} ${mode === 'edit' ? 'opacity-60' : ''}`}>{t.label}</button>
            ))}
          </div>
        </div>

        <div><label className={label}>{type === 'email' ? 'Subject' : type === 'sms' ? 'Label' : 'Title'}</label>
          <input className={input} placeholder={type === 'email' ? 'Email subject line' : type === 'sms' ? 'e.g. Post-demo nudge' : 'Internal name for this creative'} value={title} onChange={(e) => setTitle(e.target.value)} /></div>

        {type === 'ad_copy' && <>
          <div><label className={label}>Headline</label><input className={input} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Your AI employee, working 24/7" /></div>
          <div><label className={label}>Primary text</label><textarea className={textarea} rows={3} value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="The body of the ad…" /></div>
          <div><label className={label}>CTA</label><input className={input} value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Get a free demo" /></div>
          {platformSelect}{campaignSelect}
        </>}
        {type === 'image' && <>
          <div><label className={label}>Image URL</label><input className={input} value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} placeholder="https://…/image.png" /><p className="mt-1 text-[11px] text-muted">Paste a hosted image URL. Direct upload coming soon.</p></div>
          <div><label className={label}>Notes</label><textarea className={textarea} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where/how to use this image…" /></div>
          {platformSelect}{campaignSelect}
        </>}
        {type === 'video' && <>
          <div><label className={label}>Video URL</label><input className={input} value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} placeholder="https://…/video (upload coming soon)" /></div>
          <div><label className={label}>Script</label><textarea className={textarea} rows={4} value={script} onChange={(e) => setScript(e.target.value)} placeholder="The spoken/on-screen script…" /></div>
          {platformSelect}{campaignSelect}
        </>}
        {type === 'email' && <>
          <div><label className={label}>Body</label><textarea className={textarea} rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Email body…" /></div>
          {campaignSelect}
        </>}
        {type === 'sms' && <>
          <div><label className={label}>Message</label><textarea className={textarea} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Text message…" /></div>
          {campaignSelect}
        </>}
        {type === 'call_script' && <>
          <div><label className={label}>Script</label><textarea className={textarea} rows={6} value={script} onChange={(e) => setScript(e.target.value)} placeholder="Call / sales script…" /></div>
          <div><label className={label}>Use case</label><input className={input} value={useCase} onChange={(e) => setUseCase(e.target.value)} placeholder="e.g. Cold call opener" /></div>
          {campaignSelect}
        </>}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink">Cancel</button>
          <button type="submit" className="h-10 flex-1 rounded-lg bg-ink text-sm font-medium text-white">{mode === 'create' ? 'Add creative' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ── Landing pages ──
interface LP { id: string; slug: string; headline: string; subhead: string | null; cta_text: string; views: number; clicks: number; link_code: string | null; campaign_id: string | null; campaign_name: string | null; creative_id: string | null; creative_title: string | null; status: string; created_at: string }

function Landing({ focusCampaign }: { focusCampaign?: string }) {
  const [list, setList] = useState<LP[]>([])
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  const [origin, setOrigin] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [preview, setPreview] = useState<LP | null>(null)
  const [f, setF] = useState({ headline: '', subhead: '', cta_text: 'Start free — set up your AI employee', campaign_id: focusCampaign || '' })

  useEffect(() => { setOrigin(window.location.origin) }, [])
  const load = useCallback(async () => {
    const [j, c] = await Promise.all([fetch('/api/partner/landing-pages').then((r) => r.json()), fetch('/api/partner/campaigns').then((r) => r.json())])
    setList(j.pages || []); setCampaigns((c.campaigns || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (focusCampaign) { setShowCreate(true); setF((p) => ({ ...p, campaign_id: focusCampaign })) } }, [focusCampaign])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!f.headline.trim()) return toast.error('Add a headline')
    const r = await fetch('/api/partner/landing-pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, campaign_id: f.campaign_id || null }) })
    if (!r.ok) return toast.error('Could not create page')
    toast.success('Landing page published'); setF({ headline: '', subhead: '', cta_text: 'Start free — set up your AI employee', campaign_id: '' }); setShowCreate(false); load()
  }
  async function setStatus(id: string, status: string) { await fetch('/api/partner/landing-pages', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); load() }
  const url = (p: LP) => `${origin}/l/${p.slug}`

  const createForm = (
    <Panel title="New landing page">
      <form onSubmit={create} className="space-y-2">
        <input className={input} placeholder="Headline — e.g. An AI employee for your business" value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} />
        <input className={input} placeholder="Subheadline (optional — we'll use strong default copy)" value={f.subhead} onChange={(e) => setF({ ...f, subhead: e.target.value })} />
        <div className="flex flex-wrap gap-2">
          <input className={`${input} flex-1 min-w-[160px]`} placeholder="CTA text" value={f.cta_text} onChange={(e) => setF({ ...f, cta_text: e.target.value })} />
          <select className={`${input} w-48`} value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">No campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
        <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Publish page</button>
      </form>
    </Panel>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-subtle">Hosted pages that live inside Scalix — share the link anywhere. Every view, click, and signup is tracked and attributed to you.</p>
        {list.length > 0 && <button onClick={() => setShowCreate((v) => !v)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> New page</button>}
      </div>

      {list.length === 0 ? (
        <>
          <EducationalEmpty icon={LayoutTemplate} title="Send traffic to a page that converts" body="Publish a branded, Scalix-hosted landing page with your headline and CTA — no external tools, no broken links. Share it in ads, posts, and DMs; every view and signup attributes back to you automatically." cta={<button onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create your first page</button>} />
          {showCreate && createForm}
        </>
      ) : (
        <>
          {showCreate && createForm}
          <div className="grid gap-3 lg:grid-cols-2">
            {list.map((p) => (
              <div key={p.id} className="flex flex-col rounded-2xl border border-hairline bg-surface p-4 shadow-e1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{p.headline}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted">/l/{p.slug}{p.campaign_name && ` · ${p.campaign_name}`}{p.creative_title && ` · ${p.creative_title}`}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[p.status] || STATUS_STYLE.published}`}>{p.status}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 border-t border-hairline pt-3">
                  <CampaignMetric label="Views" value={String(p.views)} note="auto" />
                  <CampaignMetric label="Clicks" value={String(p.clicks)} note="auto" />
                  <CampaignMetric label="CTA" value={p.link_code ? 'Tracked' : '—'} />
                </div>
                <p className="mt-2 text-[11px] text-muted">Demos, trials & paid customers from this page roll up to its campaign in Performance.</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-3">
                  <button onClick={() => { navigator.clipboard.writeText(url(p)); toast.success('Link copied') }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><Link2 className="h-3.5 w-3.5" /> Copy link</button>
                  <button onClick={() => setPreview(p)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><Eye className="h-3.5 w-3.5" /> Preview</button>
                  <a href={url(p)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline-strong px-2.5 text-xs font-medium text-subtle hover:text-ink"><ExternalLink className="h-3.5 w-3.5" /> Open</a>
                  <div className="ml-auto">
                    {p.status !== 'archived'
                      ? <button onClick={() => setStatus(p.id, 'archived')} title="Archive" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><Archive className="h-3.5 w-3.5" /></button>
                      : <button onClick={() => setStatus(p.id, 'published')} title="Republish" className="rounded-md border border-hairline-strong p-1.5 text-subtle hover:text-ink"><RotateCcw className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {preview && (
        <Modal title="Landing page preview" onClose={() => setPreview(null)}>
          <div className="rounded-xl border border-hairline bg-canvas p-6 text-center">
            <span className="mb-3 inline-flex items-center rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent-strong">Your AI employee</span>
            <h2 className="text-xl font-semibold text-ink">{preview.headline}</h2>
            <p className="mt-2 text-sm text-subtle">{preview.subhead || 'An AI employee that learns your business, answers every call and message 24/7, follows up with every lead, and tells you what to do next.'}</p>
            <span className="mt-4 inline-flex h-10 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-white">{preview.cta_text}</span>
            <p className="mt-4 text-[11px] text-muted">Powered by Scalix26</p>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => { navigator.clipboard.writeText(url(preview)); toast.success('Link copied') }} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong text-sm font-medium text-subtle hover:text-ink"><Link2 className="h-4 w-4" /> Copy link</button>
            <a href={url(preview)} target="_blank" rel="noreferrer" className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white"><ExternalLink className="h-4 w-4" /> Open live</a>
          </div>
        </Modal>
      )}
    </div>
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
      <div className="rounded-xl border border-accent/20 bg-accent/[0.04] px-4 py-3 text-sm text-subtle">
        <span className="font-medium text-ink">Track what you spend per channel</span> so Scalix can compute your CAC, ROI, and payback against the customers each campaign produces. Spend is entered manually for now — Meta, Google, TikTok &amp; LinkedIn syncs plug in here later with no re-entry.
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total spend" value={money(total)} />
        <StatCard label="Spend this month" value={money(thisMonth)} />
        <StatCard label="Best ROI campaign" value={bestRoi ? `${bestRoi.roi_pct}%` : '—'} hint={bestRoi ? bestRoi.name : 'Needs spend + a paid customer'} />
        <StatCard label="Top spend channel" value={topChannel ? topChannel[0] : '—'} hint={topChannel ? money(topChannel[1]) : 'No spend yet'} />
      </div>

      <Panel title="Log ad spend">
        <form onSubmit={add} className="flex flex-wrap gap-2">
          <select className={`${input} w-28 capitalize`} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{['meta', 'google', 'tiktok', 'linkedin', 'other'].map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}</select>
          <input className={`${input} w-28`} placeholder="Amount $" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <select className={`${input} w-44`} value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">No campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="date" className={`${input} w-36`} value={f.spend_date} onChange={(e) => setF({ ...f, spend_date: e.target.value })} />
          <input className={`${input} flex-1 min-w-[140px]`} placeholder="Note (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Add</button>
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
                  <td className="py-2 text-right"><button onClick={() => del(r.id)} className="text-muted hover:text-red-600" title="Delete"><X className="h-3.5 w-3.5" /></button></td>
                </tr>
              )
            })}</tbody>
          </table></div>
        )}
      </Panel>
    </div>
  )
}
