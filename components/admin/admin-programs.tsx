'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'

interface Plan { id: string; partner_id: string | null; name: string; model: string; recurring_pct: number | null; one_time_cents: number | null; duration_months: number | null; active: boolean }
interface Campaign { id: string; name: string; kind: string; amount_cents: number | null; threshold: number | null; active: boolean; partner_type: string | null }
interface Review { id: string; rating: number; body: string | null; status: string; partners: { company_name: string | null } | null }
interface Rule { id: string; name: string; metric: string; threshold: number; action: string; to_type: string | null; to_tier: number | null; active: boolean }
interface Deal { id: string; partner_id: string; active: boolean; note: string | null; partners: { company_name: string | null; slug: string } | null; commission_plans: { name: string } | null }
interface PartnerLite { id: string; company_name: string | null; slug: string }

export function AdminPrograms({ canWrite }: { canWrite: boolean }) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [partnersList, setPartnersList] = useState<PartnerLite[]>([])

  const load = useCallback(async () => {
    const [p, c, r, u, d] = await Promise.all([
      fetch('/api/admin/commission-plans').then((x) => x.json()),
      fetch('/api/admin/bonus-campaigns').then((x) => x.json()),
      fetch('/api/admin/reviews').then((x) => x.json()),
      fetch('/api/admin/upgrade-rules').then((x) => x.json()),
      fetch('/api/admin/deals').then((x) => x.json()),
    ])
    setPlans(p.plans || []); setPartnersList(p.partners || []); setCampaigns(c.campaigns || [])
    setReviews(r.reviews || []); setRules(u.rules || []); setDeals(d.deals || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function moderate(id: string, status: string) {
    const res = await fetch('/api/admin/reviews', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (!res.ok) return toast.error('Failed'); load()
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Commission plans</h2>
          {canWrite && <NewPlan onSaved={load} />}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Scope</th><th className="px-3 py-2">Model</th><th className="px-3 py-2">Terms</th><th className="px-3 py-2">Active</th>
            </tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">{p.name}</td>
                  <td className="px-3 py-2 text-gray-500">{p.partner_id ? 'Partner-specific' : 'Global default'}</td>
                  <td className="px-3 py-2 text-gray-600">{p.model}</td>
                  <td className="px-3 py-2 text-gray-600">{p.recurring_pct ? `${p.recurring_pct}%` : ''}{p.one_time_cents ? ` +$${(p.one_time_cents / 100).toFixed(0)} bounty` : ''}{p.duration_months ? ` · ${p.duration_months}mo` : p.recurring_pct ? ' · lifetime' : ''}</td>
                  <td className="px-3 py-2">{p.active ? <span className="text-green-600">●</span> : <span className="text-gray-300">●</span>}</td>
                </tr>
              ))}
              {plans.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No plans yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Bonus campaigns</h2>
          {canWrite && <NewCampaign onSaved={load} />}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Active</th>
            </tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">{c.name}</td>
                  <td className="px-3 py-2 text-gray-600">{c.kind}</td>
                  <td className="px-3 py-2 text-gray-600">{c.amount_cents ? `$${(c.amount_cents / 100).toFixed(0)}` : '—'}</td>
                  <td className="px-3 py-2">{c.active ? <span className="text-green-600">●</span> : <span className="text-gray-300">●</span>}</td>
                </tr>
              ))}
              {campaigns.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">No campaigns yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Upgrade rules</h2>
          {canWrite && <NewRule onSaved={load} />}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">When</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Active</th>
            </tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                  <td className="px-3 py-2 text-gray-600">{r.metric} ≥ {r.threshold}</td>
                  <td className="px-3 py-2 text-gray-600">{r.action}{r.to_type ? ` → ${r.to_type}` : ''}{r.to_tier != null ? ` → tier ${r.to_tier}` : ''}</td>
                  <td className="px-3 py-2">{r.active ? <span className="text-green-600">●</span> : <span className="text-gray-300">●</span>}</td>
                </tr>
              ))}
              {rules.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">No upgrade rules.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Partner deals</h2>
          {canWrite && <NewDeal partners={partnersList} plans={plans} onSaved={load} />}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="px-3 py-2">Partner</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Note</th><th className="px-3 py-2">Active</th>
            </tr></thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">{d.partners?.company_name || d.partners?.slug || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{d.commission_plans?.name || '—'}</td>
                  <td className="px-3 py-2 max-w-xs truncate text-gray-500">{d.note || '—'}</td>
                  <td className="px-3 py-2">{d.active ? <span className="text-green-600">●</span> : <span className="text-gray-300">●</span>}</td>
                </tr>
              ))}
              {deals.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">No partner deals.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-gray-900">Marketplace reviews</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="px-3 py-2">Partner</th><th className="px-3 py-2">Rating</th><th className="px-3 py-2">Review</th><th className="px-3 py-2">Status</th>{canWrite && <th className="px-3 py-2">Moderate</th>}
            </tr></thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">{r.partners?.company_name || '—'}</td>
                  <td className="px-3 py-2 text-amber-500">{'★'.repeat(r.rating)}</td>
                  <td className="px-3 py-2 max-w-xs truncate text-gray-600">{r.body || '—'}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${r.status === 'published' ? 'bg-green-50 text-green-700' : r.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>{r.status}</span></td>
                  {canWrite && (
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => moderate(r.id, 'published')} className="rounded border border-green-200 px-2 py-1 text-xs text-green-700 hover:bg-green-50">Publish</button>
                        <button onClick={() => moderate(r.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Reject</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {reviews.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No reviews yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

const inp = 'h-9 rounded border border-gray-300 px-2 text-sm'

function NewPlan({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', model: 'recurring_pct', recurring_pct: '30', one_time_cents: '', duration_months: '', tiers: '', wholesale_discount_pct: '', setup_fee: '' })
  async function save() {
    let tiers = null
    if (f.tiers.trim()) { try { tiers = JSON.parse(f.tiers) } catch { return toast.error('Tiers must be valid JSON') } }
    const res = await fetch('/api/admin/commission-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      name: f.name, model: f.model,
      recurring_pct: f.recurring_pct ? Number(f.recurring_pct) : null,
      one_time_cents: f.one_time_cents ? Math.round(Number(f.one_time_cents) * 100) : null,
      duration_months: f.duration_months ? Number(f.duration_months) : null,
      tiers,
      wholesale_discount_pct: f.wholesale_discount_pct ? Number(f.wholesale_discount_pct) : null,
      setup_fee_cents: f.setup_fee ? Math.round(Number(f.setup_fee) * 100) : null,
    }) })
    if (!res.ok) { const j = await res.json(); return toast.error(j.error || 'Failed') }
    toast.success('Plan created'); setOpen(false); onSaved()
  }
  if (!open) return <button onClick={() => setOpen(true)} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">+ New plan</button>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={inp} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <select className={inp} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}>
        <option value="recurring_pct">Recurring %</option><option value="one_time">One-time</option><option value="tiered">Tiered</option><option value="hybrid">Hybrid</option><option value="wholesale">Wholesale</option><option value="white_label">White Label</option><option value="custom">Custom</option>
      </select>
      <input className={`${inp} w-16`} placeholder="%" value={f.recurring_pct} onChange={(e) => setF({ ...f, recurring_pct: e.target.value })} />
      <input className={`${inp} w-20`} placeholder="Bounty $" value={f.one_time_cents} onChange={(e) => setF({ ...f, one_time_cents: e.target.value })} />
      <input className={`${inp} w-24`} placeholder="Months (∞)" value={f.duration_months} onChange={(e) => setF({ ...f, duration_months: e.target.value })} />
      {(f.model === 'wholesale' || f.model === 'white_label') && <>
        <input className={`${inp} w-24`} placeholder="Wholesale %" value={f.wholesale_discount_pct} onChange={(e) => setF({ ...f, wholesale_discount_pct: e.target.value })} />
        <input className={`${inp} w-20`} placeholder="Setup $" value={f.setup_fee} onChange={(e) => setF({ ...f, setup_fee: e.target.value })} />
      </>}
      <input className={`${inp} w-72`} placeholder='Tiers JSON [{"min_customers":0,"pct":30}]' value={f.tiers} onChange={(e) => setF({ ...f, tiers: e.target.value })} />
      <button onClick={save} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">Save</button>
      <button onClick={() => setOpen(false)} className="text-sm text-gray-500">Cancel</button>
    </div>
  )
}

function NewRule({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', metric: 'active_customers', threshold: '10', action: 'suggest_type', to_type: 'growth', to_tier: '', message: '' })
  async function save() {
    const res = await fetch('/api/admin/upgrade-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      name: f.name, metric: f.metric, threshold: Number(f.threshold), action: f.action,
      to_type: f.action === 'suggest_type' ? f.to_type : null, to_tier: f.action === 'set_tier' && f.to_tier ? Number(f.to_tier) : null, message: f.message,
    }) })
    if (!res.ok) { const j = await res.json(); return toast.error(j.error || 'Failed') }
    toast.success('Rule created'); setOpen(false); onSaved()
  }
  if (!open) return <button onClick={() => setOpen(true)} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">+ New rule</button>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={inp} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <select className={inp} value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>
        <option value="active_customers">active_customers</option><option value="mrr_cents">mrr_cents</option><option value="xp">xp</option><option value="lifetime_earnings_cents">lifetime_earnings_cents</option>
      </select>
      <input className={`${inp} w-20`} placeholder="≥" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} />
      <select className={inp} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
        <option value="suggest_type">suggest_type</option><option value="set_tier">set_tier</option><option value="notify">notify</option>
      </select>
      {f.action === 'suggest_type' && <input className={`${inp} w-28`} placeholder="to type" value={f.to_type} onChange={(e) => setF({ ...f, to_type: e.target.value })} />}
      {f.action === 'set_tier' && <input className={`${inp} w-16`} placeholder="tier" value={f.to_tier} onChange={(e) => setF({ ...f, to_tier: e.target.value })} />}
      <input className={`${inp} w-64`} placeholder="Message" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      <button onClick={save} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">Save</button>
      <button onClick={() => setOpen(false)} className="text-sm text-gray-500">Cancel</button>
    </div>
  )
}

function NewDeal({ partners, plans, onSaved }: { partners: PartnerLite[]; plans: Plan[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ partner_id: '', commission_plan_id: '', note: '' })
  async function save() {
    if (!f.partner_id) return toast.error('Pick a partner')
    const res = await fetch('/api/admin/deals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
    if (!res.ok) { const j = await res.json(); return toast.error(j.error || 'Failed') }
    toast.success('Deal created'); setOpen(false); onSaved()
  }
  if (!open) return <button onClick={() => setOpen(true)} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">+ New deal</button>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={inp} value={f.partner_id} onChange={(e) => setF({ ...f, partner_id: e.target.value })}>
        <option value="">Partner…</option>
        {partners.map((p) => <option key={p.id} value={p.id}>{p.company_name || p.slug}</option>)}
      </select>
      <select className={inp} value={f.commission_plan_id} onChange={(e) => setF({ ...f, commission_plan_id: e.target.value })}>
        <option value="">Plan…</option>
        {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input className={`${inp} w-48`} placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <button onClick={save} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">Save</button>
      <button onClick={() => setOpen(false)} className="text-sm text-gray-500">Cancel</button>
    </div>
  )
}

function NewCampaign({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', kind: 'signup_bounty', amount_cents: '' })
  async function save() {
    const res = await fetch('/api/admin/bonus-campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, kind: f.kind, amount_cents: f.amount_cents ? Math.round(Number(f.amount_cents) * 100) : null }) })
    if (!res.ok) { const j = await res.json(); return toast.error(j.error || 'Failed') }
    toast.success('Campaign created'); setOpen(false); onSaved()
  }
  if (!open) return <button onClick={() => setOpen(true)} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">+ New campaign</button>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={inp} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <select className={inp} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        <option value="signup_bounty">Signup bounty</option><option value="conversion_bounty">Conversion bounty</option><option value="volume_bonus">Volume bonus</option><option value="sprint">Sprint</option>
      </select>
      <input className={`${inp} w-20`} placeholder="$" value={f.amount_cents} onChange={(e) => setF({ ...f, amount_cents: e.target.value })} />
      <button onClick={save} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">Save</button>
      <button onClick={() => setOpen(false)} className="text-sm text-gray-500">Cancel</button>
    </div>
  )
}
