'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { MODULES, moduleLabel, type ModuleKey } from '@/lib/modules'
import { ALLOWED_TAGS } from '@/lib/admin/tags'
import { useToast } from '@/components/admin/toast'

interface Detail {
  id: string
  general: { business_name: string; industry: string | null; website: string | null; phone: string | null; address: string | null; created_at: string; timezone: string | null }
  owner: { name: string | null; email: string | null; last_login: string | null; joined: string | null }
  subscription: { plan: string | null; revenue: number; stripe_customer_id: string | null; stripe_subscription_id: string | null; trial_ends_at: string | null; renewal_date: string | null; payment_status: string | null }
  usage: { calls: number; minutes: number; messages: number; sms: number; whatsapp: number; facebook: number; instagram: number; emails: number; period: string }
  ai: { agents: { id: string; name: string; voice: string | null; status: string; prompt_excerpt: string | null }[]; knowledge_base_items: number; memory_pct: number | null }
  connected: { twilio: boolean; facebook: boolean; instagram: boolean; stripe: boolean; google: boolean | null; microsoft: boolean | null }
  modules: ModuleKey[]
  tags: string[]
  suspended: boolean
  notes: { id: string; admin_email: string; body: string; created_at: string }[]
  audit: { id: string; admin_email: string; action: string; before: unknown; after: unknown; created_at: string }[]
}

const fmt = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString() } catch { return iso } }
const yesno = (v: boolean | null) => (v === null ? 'Not tracked yet' : v ? 'Connected' : 'Not connected')
const svcCls = (v: boolean | null) => (v === null ? 'text-subtle' : v ? 'text-emerald-600' : 'text-muted')

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline-strong bg-white p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-ink">{title}</h2>{action}</div>
      {children}
    </div>
  )
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-wide text-subtle">{label}</dt><dd className="mt-0.5 text-sm text-ink break-words">{value ?? '—'}</dd></div>
}

export default function AdminBusinessDetail() {
  const { id } = useParams<{ id: string }>()
  const [d, setD] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [noteText, setNoteText] = useState('')
  const { show, node: toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/businesses/${id}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to load')
      setD(j.business)
    } catch (e) { show((e as Error).message, 'err') } finally { setLoading(false) }
  }, [id, show])
  useEffect(() => { load() }, [load])

  async function toggleModule(key: ModuleKey) {
    if (!d) return
    const next = d.modules.includes(key) ? d.modules.filter((m) => m !== key) : [...d.modules, key]
    setD({ ...d, modules: next })
    const res = await fetch('/api/admin/modules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: id, enabled_modules: next }) })
    const j = await res.json()
    if (!res.ok) { show(j.error || 'Save failed', 'err'); load() } else { setD((p) => p ? { ...p, modules: j.enabled_modules } : p); show(`Modules updated`) }
  }

  async function toggleTag(tag: string) {
    if (!d) return
    const next = d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag]
    setD({ ...d, tags: next })
    const res = await fetch(`/api/admin/businesses/${id}/tags`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: next }) })
    const j = await res.json()
    if (!res.ok) { show(j.error || 'Save failed', 'err'); load() } else { show('Tags updated') }
  }

  async function addNote() {
    const body = noteText.trim(); if (!body) return
    setBusy(true)
    const res = await fetch(`/api/admin/businesses/${id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) })
    const j = await res.json()
    setBusy(false)
    if (!res.ok) { show(j.error || 'Failed', 'err') } else { setNoteText(''); show('Note added'); load() }
  }

  async function setSuspended(suspend: boolean) {
    if (!confirm(suspend ? 'Suspend this business?' : 'Reactivate this business?')) return
    setBusy(true)
    const res = await fetch(`/api/admin/businesses/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: suspend ? 'suspend' : 'reactivate' }) })
    const j = await res.json()
    setBusy(false)
    if (!res.ok) { show(j.error || 'Failed', 'err') } else { show(suspend ? 'Suspended' : 'Reactivated'); load() }
  }

  async function impersonate() {
    if (!confirm('Open this customer’s dashboard as them? This starts a real session as the owner and is logged.')) return
    setBusy(true)
    const res = await fetch('/api/admin/impersonate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: id }) })
    const j = await res.json()
    setBusy(false)
    if (!res.ok) { show(j.error || 'Failed', 'err') } else { window.location.href = j.url }
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>
  if (!d) return <p className="text-sm text-muted">Not found. <Link href="/admin/businesses" className="text-accent-strong hover:underline">Back</Link></p>

  return (
    <div>
      {toast}
      <Link href="/admin/businesses" className="text-sm text-subtle hover:text-ink">← Businesses</Link>

      <div className="mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{d.general.business_name || 'Untitled'}</h1>
          <p className="text-sm text-subtle">
            {d.owner.email || '—'} · <span className="capitalize">{d.subscription.plan || '—'}</span>
            {d.suspended && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Suspended</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={impersonate} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">Login as customer</button>
          {d.suspended
            ? <button onClick={() => setSuspended(false)} disabled={busy} className="rounded-lg border border-hairline-strong px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-sunken">Reactivate</button>
            : <button onClick={() => setSuspended(true)} disabled={busy} className="rounded-lg border border-hairline-strong px-4 py-2 text-sm font-medium text-red-600 hover:bg-sunken">Suspend</button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="General">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Business" value={d.general.business_name} />
            <Field label="Industry" value={d.general.industry} />
            <Field label="Website" value={d.general.website} />
            <Field label="Phone" value={d.general.phone} />
            <Field label="Address" value={d.general.address} />
            <Field label="Created" value={fmt(d.general.created_at)} />
          </dl>
        </Card>

        <Card title="Owner">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Name" value={d.owner.name} />
            <Field label="Email" value={d.owner.email} />
            <Field label="Last login" value={fmt(d.owner.last_login)} />
            <Field label="Joined" value={fmt(d.owner.joined)} />
          </dl>
        </Card>

        <Card title="Subscription">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Plan" value={<span className="capitalize">{d.subscription.plan || '—'}</span>} />
            <Field label="Revenue / mo" value={`$${d.subscription.revenue.toLocaleString()}`} />
            <Field label="Stripe customer" value={d.subscription.stripe_customer_id} />
            <Field label="Renewal date" value={d.subscription.renewal_date || 'Not tracked yet'} />
            <Field label="Payment status" value={d.subscription.payment_status || 'Not tracked yet'} />
            <Field label="Trial ends" value={fmt(d.subscription.trial_ends_at)} />
          </dl>
        </Card>

        <Card title={`Usage — this month`}>
          <dl className="grid grid-cols-3 gap-3">
            <Field label="AI Calls" value={d.usage.calls} />
            <Field label="Minutes" value={d.usage.minutes} />
            <Field label="Messages" value={d.usage.messages} />
            <Field label="SMS" value={d.usage.sms} />
            <Field label="WhatsApp" value={d.usage.whatsapp} />
            <Field label="Emails" value={d.usage.emails} />
            <Field label="Facebook" value={d.usage.facebook} />
            <Field label="Instagram" value={d.usage.instagram} />
            <Field label="Tokens" value={<span className="text-subtle">Not tracked yet</span>} />
          </dl>
        </Card>

        <Card title="AI">
          <dl className="mb-3 grid grid-cols-2 gap-3">
            <Field label="Knowledge base" value={`${d.ai.knowledge_base_items} items`} />
            <Field label="Memory" value={d.ai.memory_pct === null ? <span className="text-subtle">Not tracked yet</span> : `${d.ai.memory_pct}%`} />
          </dl>
          <div className="space-y-2">
            {d.ai.agents.length === 0 ? <p className="text-sm text-muted">No agents.</p> : d.ai.agents.map((a) => (
              <div key={a.id} className="rounded-lg border border-hairline p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{a.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${a.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-sunken text-subtle'}`}>{a.status}</span>
                </div>
                <div className="text-xs text-subtle">Voice: {a.voice || '—'}</div>
                {a.prompt_excerpt && <p className="mt-1 line-clamp-2 text-xs text-muted">{a.prompt_excerpt}…</p>}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Connected services">
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {([['Twilio', d.connected.twilio], ['Facebook', d.connected.facebook], ['Instagram', d.connected.instagram], ['Stripe', d.connected.stripe], ['Google', d.connected.google], ['Microsoft', d.connected.microsoft]] as [string, boolean | null][]).map(([name, v]) => (
              <li key={name} className="flex items-center justify-between rounded-lg border border-hairline px-3 py-2">
                <span className="text-ink">{name}</span>
                <span className={`text-xs font-medium ${svcCls(v)}`}>{yesno(v)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Modules">
          <div className="divide-y divide-hairline">
            {MODULES.map((m) => {
              const on = d.modules.includes(m.key)
              return (
                <div key={m.key} className="flex items-center justify-between py-2.5">
                  <div><div className="text-sm font-medium text-ink">{m.label}</div><div className="text-xs text-subtle">{m.description}</div></div>
                  <button onClick={() => toggleModule(m.key)} role="switch" aria-checked={on} className={`relative inline-flex h-6 w-11 items-center rounded-full ${on ? 'bg-accent' : 'bg-hairline-strong'}`}>
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              )
            })}
          </div>
        </Card>

        <Card title="Tags">
          <div className="flex flex-wrap gap-2">
            {ALLOWED_TAGS.map((tag) => {
              const on = d.tags.includes(tag)
              return (
                <button key={tag} onClick={() => toggleTag(tag)} className={`rounded-full px-3 py-1.5 text-sm font-medium ${on ? 'bg-accent text-white' : 'border border-hairline-strong text-subtle hover:text-ink'}`}>{tag}</button>
              )
            })}
          </div>
        </Card>

        <Card title="Internal notes">
          <div className="mb-3 flex gap-2">
            <input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} placeholder="Add an internal note…" className="h-10 flex-1 rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent" />
            <button onClick={addNote} disabled={busy} className="rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-50">Add</button>
          </div>
          {d.notes.length === 0 ? <p className="text-sm text-muted">No notes.</p> : (
            <ul className="space-y-2">
              {d.notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-sunken px-3 py-2 text-sm">
                  <p className="text-ink">{n.body}</p>
                  <p className="mt-0.5 text-xs text-subtle">{n.admin_email} · {fmt(n.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Audit trail">
          {d.audit.length === 0 ? <p className="text-sm text-muted">No changes yet.</p> : (
            <ul className="space-y-2">
              {d.audit.map((a) => (
                <li key={a.id} className="border-l-2 border-hairline pl-3 text-sm">
                  <div className="text-ink"><span className="font-medium">{a.action}</span></div>
                  <div className="text-xs text-subtle">{a.admin_email} · {fmt(a.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
