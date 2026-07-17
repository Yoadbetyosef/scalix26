'use client'

import { useCallback, useEffect, useState } from 'react'
import { Package, Download, Plus, Trash2, ExternalLink } from 'lucide-react'
import { AVAILABILITY_LABELS, AVAILABILITY_STATUSES, type AvailabilityStatus, type CatalogPart } from '@/lib/catalog/types'
import { useToast } from '@/components/admin/toast'

type PartWithQr = CatalogPart & { qr: { target: string; dataUrl: string | null } }
type FormState = { name: string; image_url: string; price: string; availability_status: AvailabilityStatus; quantity: string }
const empty: FormState = { name: '', image_url: '', price: '', availability_status: 'in_stock', quantity: '0' }
const badge: Record<AvailabilityStatus, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700', out_of_stock: 'bg-red-50 text-red-700',
  incoming: 'bg-amber-50 text-amber-700', special_order: 'bg-violet-50 text-violet-700',
}
const input = 'h-10 w-full rounded-lg border border-hairline-strong px-3 text-sm'

export function PartsManager({ productId }: { productId: string }) {
  const [parts, setParts] = useState<PartWithQr[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState | null>(null) // add form
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(empty)
  const [busy, setBusy] = useState(false)
  const { show, node: toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/catalog/products/${productId}/parts`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load parts')
      setParts(d.parts || [])
    } catch (e) { show((e as Error).message, 'err') } finally { setLoading(false) }
  }, [productId, show])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount (matches the product page)
  useEffect(() => { load() }, [load])

  const toBody = (f: FormState) => ({ name: f.name, image_url: f.image_url || null, price: f.price === '' ? null : f.price, availability_status: f.availability_status, quantity: f.quantity })

  async function addPart() {
    if (!form?.name.trim()) { show('Name is required', 'err'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/catalog/products/${productId}/parts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toBody(form)) })
      const d = await res.json(); if (!res.ok) throw new Error(d.error || 'Failed')
      setParts((p) => [...p, d.part]); setForm(null); show('Part added')
    } catch (e) { show((e as Error).message, 'err') } finally { setBusy(false) }
  }

  async function saveEdit(partId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/catalog/parts/${partId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toBody(editForm)) })
      const d = await res.json(); if (!res.ok) throw new Error(d.error || 'Failed')
      setParts((p) => p.map((x) => (x.id === partId ? d.part : x))); setEditingId(null); show('Saved')
    } catch (e) { show((e as Error).message, 'err') } finally { setBusy(false) }
  }

  async function remove(partId: string) {
    if (!confirm('Delete this part?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/catalog/parts/${partId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setParts((p) => p.filter((x) => x.id !== partId)); show('Deleted')
    } catch (e) { show((e as Error).message, 'err') } finally { setBusy(false) }
  }

  function downloadQr(part: PartWithQr) {
    if (!part.qr.dataUrl) return
    const a = document.createElement('a'); a.href = part.qr.dataUrl; a.download = `${part.name || 'part'}-qr.png`; a.click()
  }
  const startEdit = (p: PartWithQr) => { setEditingId(p.id); setEditForm({ name: p.name, image_url: p.image_url || '', price: p.price?.toString() ?? '', availability_status: p.availability_status, quantity: String(p.quantity) }) }

  const renderFields = (f: FormState, set: (patch: Partial<FormState>) => void) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label className="col-span-2 block"><span className="mb-1 block text-xs text-subtle">Part name</span><input className={input} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Left armrest" /></label>
      <label className="block"><span className="mb-1 block text-xs text-subtle">Price</span><input className={input} type="number" min={0} step="0.01" value={f.price} onChange={(e) => set({ price: e.target.value })} placeholder="—" /></label>
      <label className="block"><span className="mb-1 block text-xs text-subtle">Availability</span><select className={input} value={f.availability_status} onChange={(e) => set({ availability_status: e.target.value as AvailabilityStatus })}>{AVAILABILITY_STATUSES.map((a) => <option key={a} value={a}>{AVAILABILITY_LABELS[a]}</option>)}</select></label>
      <label className="col-span-2 block sm:col-span-3"><span className="mb-1 block text-xs text-subtle">Photo (image URL)</span><input className={input} value={f.image_url} onChange={(e) => set({ image_url: e.target.value })} placeholder="Paste a direct image URL" /></label>
      <label className="block"><span className="mb-1 block text-xs text-subtle">Quantity</span><input className={input} type="number" min={0} value={f.quantity} onChange={(e) => set({ quantity: e.target.value })} /></label>
    </div>
  )

  return (
    <div className="mt-4 rounded-xl border border-hairline-strong bg-white p-4">
      {toast}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-ink">Parts <span className="text-sm font-normal text-subtle">({parts.length})</span></h3>
        {!form && <button onClick={() => setForm(empty)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken"><Plus className="h-4 w-4" /> Add part</button>}
      </div>

      {form && (
        <div className="mb-3 rounded-lg border border-accent/30 p-3">
          {renderFields(form, (patch) => setForm((s) => ({ ...(s || empty), ...patch })))}
          <div className="mt-3 flex gap-2">
            <button onClick={addPart} disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Add part</button>
            <button onClick={() => setForm(null)} className="rounded-lg border border-hairline-strong px-4 py-2 text-sm text-subtle">Cancel</button>
          </div>
        </div>
      )}

      {loading ? <p className="text-sm text-muted">Loading…</p> : parts.length === 0 && !form ? (
        <p className="text-sm text-muted">No parts yet. Add the pieces this product is made of — each gets its own price, availability, and QR code.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {parts.map((p) => editingId === p.id ? (
            <li key={p.id} className="py-3">
              {renderFields(editForm, (patch) => setEditForm((s) => ({ ...s, ...patch })))}
              <div className="mt-3 flex gap-2">
                <button onClick={() => saveEdit(p.id)} disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Save</button>
                <button onClick={() => setEditingId(null)} className="rounded-lg border border-hairline-strong px-4 py-2 text-sm text-subtle">Cancel</button>
              </div>
            </li>
          ) : (
            <li key={p.id} className="flex items-center gap-3 py-3">
              {p.image_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={p.image_url} alt="" className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" />
                : <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-sunken text-muted"><Package className="h-5 w-5" /></span>}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{p.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge[p.availability_status]}`}>{AVAILABILITY_LABELS[p.availability_status]}</span>
                  {p.price !== null && <span className="text-sm font-semibold text-ink">${p.price.toLocaleString()}</span>}
                  <span className="text-xs text-subtle">Qty {p.quantity}</span>
                </div>
              </div>
              {p.qr.dataUrl && (
                <button onClick={() => downloadQr(p)} title="Download QR" className="flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.qr.dataUrl} alt="Part QR" className="h-14 w-14 rounded border border-hairline" />
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-subtle"><Download className="h-3 w-3" /> QR</span>
                </button>
              )}
              <div className="flex flex-col gap-1">
                <a href={p.qr.target} target="_blank" rel="noreferrer" title="Open public page" className="rounded p-1.5 text-subtle hover:bg-sunken hover:text-ink"><ExternalLink className="h-4 w-4" /></a>
                <button onClick={() => startEdit(p)} className="rounded px-2 py-1 text-xs font-medium text-ink hover:bg-sunken">Edit</button>
                <button onClick={() => remove(p.id)} className="rounded p-1.5 text-red-600 hover:bg-sunken"><Trash2 className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
