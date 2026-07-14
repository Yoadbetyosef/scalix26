'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CostItem } from '@/lib/command-center/costs'

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const COGS_CATS = ['voice', 'phone_numbers', 'sms', 'whatsapp', 'ai_inference', 'stt', 'tts', 'email', 'storage', 'hosting', 'database', 'monitoring', 'payment_processing', 'refunds', 'chargebacks', 'support_delivery', 'onboarding_delivery', 'affiliate_commissions', 'whitelabel_servicing']
const OPEX_CATS = ['payroll', 'contractors', 'marketing', 'software', 'legal', 'accounting', 'insurance', 'travel', 'events', 'office', 'recruiting', 'other']
type Row = Record<string, string>
const post = (method: string, body: unknown) => fetch('/api/admin/command-center/cost', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function CostForm({ d, setD, onSave, onCancel, busy }: { d: Row; setD: (f: (p: Row) => Row) => void; onSave: () => void; onCancel: () => void; busy: boolean }) {
  const cats = d.costType === 'cogs' ? COGS_CATS : OPEX_CATS
  return (
    <div className="rounded-xl border border-hairline-strong bg-sunken/40 p-3">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <label className="block text-xs text-subtle">Type<select value={d.costType} onChange={(e) => setD((p) => ({ ...p, costType: e.target.value, category: (e.target.value === 'cogs' ? COGS_CATS : OPEX_CATS)[0] }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm"><option value="cogs">COGS</option><option value="opex">OpEx</option></select></label>
        <label className="block text-xs text-subtle">Category<select value={d.category} onChange={(e) => setD((p) => ({ ...p, category: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm">{cats.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select></label>
        <label className="block text-xs text-subtle">Amount ($)<input value={d.amount} onChange={(e) => setD((p) => ({ ...p, amount: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
        <label className="block text-xs text-subtle">Recurrence<select value={d.recurrence} onChange={(e) => setD((p) => ({ ...p, recurrence: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm"><option value="monthly">monthly</option><option value="annual">annual</option><option value="one_time">one-time</option></select></label>
        <label className="block text-xs text-subtle">Vendor<input value={d.vendor} onChange={(e) => setD((p) => ({ ...p, vendor: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
        <label className="block text-xs text-subtle">Start<input type="date" value={d.startDate} onChange={(e) => setD((p) => ({ ...p, startDate: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
        <label className="block text-xs text-subtle">End (optional)<input type="date" value={d.endDate} onChange={(e) => setD((p) => ({ ...p, endDate: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
        <label className="block text-xs text-subtle">Notes<input value={d.notes} onChange={(e) => setD((p) => ({ ...p, notes: e.target.value }))} className="mt-0.5 w-full rounded border border-hairline-strong px-2 py-1 text-sm" /></label>
      </div>
      <div className="mt-2 flex gap-2"><button onClick={onSave} disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save</button><button onClick={onCancel} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm">Cancel</button></div>
    </div>
  )
}

export function CostEditor({ items }: { items: CostItem[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null); const [adding, setAdding] = useState(false)
  const [d, setD] = useState<Row>({}); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const blank = (): Row => ({ costType: 'cogs', category: 'voice', amount: '0', recurrence: 'monthly', vendor: '', startDate: new Date().toISOString().slice(0, 10), endDate: '', notes: '' })
  const toDraft = (c: CostItem): Row => ({ costType: c.costType, category: c.category, amount: String(c.amountCents / 100), recurrence: c.recurrence, vendor: c.vendor ?? '', startDate: c.startDate, endDate: c.endDate ?? '', notes: c.notes ?? '' })
  const save = async (id: string | null) => {
    setBusy(true); setErr(null)
    try {
      const body = { id, costType: d.costType, category: d.category, amountCents: Math.round((parseFloat(d.amount) || 0) * 100), recurrence: d.recurrence, vendor: d.vendor || null, startDate: d.startDate, endDate: d.endDate || null, notes: d.notes || null }
      const r = await post('PATCH', body); if (!r.ok) throw new Error((await r.json()).error || 'Save failed')
      setEditing(null); setAdding(false); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const del = async (id: string) => { if (!confirm('Delete this cost?')) return; setBusy(true); try { const r = await post('DELETE', { id }); if (!r.ok) throw new Error('Delete failed'); router.refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const cancel = () => { setEditing(null); setAdding(false) }

  return (
    <div>
      {err && <div className="mb-2 text-xs text-red-600">{err}</div>}
      <div className="mb-3">{adding ? <CostForm d={d} setD={setD} onSave={() => save(null)} onCancel={cancel} busy={busy} /> : <button onClick={() => { setD(blank()); setAdding(true); setEditing(null) }} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink">+ Add cost</button>}</div>
      {items.length === 0 && !adding && <div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 p-4 text-sm text-subtle">Manual Input Required — add actual costs to compute gross margin and cost-to-serve.</div>}
      <div className="overflow-x-auto rounded-xl border border-hairline-strong">
        <table className="min-w-full text-sm">
          <thead className="bg-sunken text-subtle"><tr>{['Type', 'Category', 'Vendor', 'Amount', 'Recurrence', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-hairline">
            {items.map((c) => (
              <>
                <tr key={c.id}>
                  <td className="px-3 py-2 uppercase text-subtle">{c.costType}</td>
                  <td className="px-3 py-2 capitalize text-ink">{c.category.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-subtle">{c.vendor ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{money(c.amountCents)}</td>
                  <td className="px-3 py-2 text-subtle">{c.recurrence.replace('_', ' ')}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><button onClick={() => { setD(toDraft(c)); setEditing(editing === c.id ? null : c.id); setAdding(false) }} className="text-xs text-ink underline">{editing === c.id ? 'Close' : 'Edit'}</button> <button onClick={() => del(c.id)} className="ml-2 text-xs text-red-600 underline">Delete</button></td>
                </tr>
                {editing === c.id && <tr key={c.id + '-e'}><td colSpan={6} className="bg-sunken px-3 py-2"><CostForm d={d} setD={setD} onSave={() => save(c.id)} onCancel={cancel} busy={busy} /></td></tr>}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
