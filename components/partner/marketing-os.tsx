'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { StatCard, Panel, EmptyRow, money } from '@/components/partner/ui'
import { MarketingLibrary } from '@/components/partner/marketing-library'
import { RoiCalculator } from '@/components/partner/roi-calculator'
import { Megaphone, Palette, LayoutTemplate, DollarSign, BarChart3, FolderOpen, Plus, Copy, ExternalLink } from 'lucide-react'

type Tab = 'performance' | 'campaigns' | 'creatives' | 'landing' | 'spend' | 'assets'
const input = 'h-9 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'

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
        {d.campaigns.length === 0 ? <EmptyRow>No campaigns yet.</EmptyRow> : (
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
        {d.creatives.length === 0 ? <EmptyRow>No creatives yet.</EmptyRow> : (
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

// ── Campaigns ──
interface Campaign { id: string; name: string; channel: string | null; status: string; budget_cents: number | null }
function Campaigns() {
  const [list, setList] = useState<Campaign[]>([]); const [f, setF] = useState({ name: '', channel: 'meta', budget: '' })
  const load = useCallback(async () => { const j = await fetch('/api/partner/campaigns').then((r) => r.json()); setList(j.campaigns || []) }, [])
  useEffect(() => { load() }, [load])
  async function create(e: React.FormEvent) { e.preventDefault(); const r = await fetch('/api/partner/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, channel: f.channel, budget_cents: f.budget ? Math.round(Number(f.budget) * 100) : null }) }); if (!r.ok) return toast.error('Failed'); toast.success('Campaign created'); setF({ name: '', channel: 'meta', budget: '' }); load() }
  async function setStatus(id: string, status: string) { await fetch('/api/partner/campaigns', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }); load() }
  return (
    <div className="space-y-6">
      <Panel title="New campaign">
        <form onSubmit={create} className="flex flex-wrap gap-2">
          <input className={`${input} flex-1 min-w-[180px]`} placeholder="Campaign name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <select className={`${input} w-32`} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{['meta', 'google', 'tiktok', 'linkedin', 'organic', 'email', 'other'].map((c) => <option key={c}>{c}</option>)}</select>
          <input className={`${input} w-28`} placeholder="Budget $" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create</button>
        </form>
      </Panel>
      <Panel title="Campaigns">
        {list.length === 0 ? <EmptyRow>No campaigns yet.</EmptyRow> : <div className="divide-y divide-hairline">{list.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-2.5">
            <span className="flex-1 text-sm font-medium text-ink">{c.name} <span className="text-xs text-muted">· {c.channel}</span></span>
            <select value={c.status} onChange={(e) => setStatus(c.id, e.target.value)} className="h-7 rounded-md border border-hairline-strong px-1.5 text-xs">{['draft', 'active', 'paused', 'archived'].map((s) => <option key={s}>{s}</option>)}</select>
          </div>
        ))}</div>}
      </Panel>
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
        {mine.length === 0 ? <EmptyRow>No creatives yet.</EmptyRow> : <div className="divide-y divide-hairline">{mine.map((c) => (
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
        {list.length === 0 ? <EmptyRow>No landing pages yet.</EmptyRow> : <div className="divide-y divide-hairline">{list.map((p) => (
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
        {list.length === 0 ? <EmptyRow>No spend logged yet.</EmptyRow> : <div className="divide-y divide-hairline">{list.map((r) => (
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
