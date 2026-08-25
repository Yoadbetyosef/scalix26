'use client'

import { useCallback, useEffect, useState } from 'react'
import { Package, Download, Plus, Trash2, ExternalLink } from 'lucide-react'
import { AVAILABILITY_LABELS, AVAILABILITY_STATUSES, type AvailabilityStatus, type CatalogPart } from '@/lib/catalog/types'
import { useToast } from '@/components/admin/toast'
import { useConfirm } from '@/components/v2/confirm'

type PartWithQr = CatalogPart & { qr: { target: string; dataUrl: string | null } }
type FormState = { name: string; image_url: string; price: string; availability_status: AvailabilityStatus; quantity: string }
const empty: FormState = { name: '', image_url: '', price: '', availability_status: 'in_stock', quantity: '0' }
// The catalogue's rule, on a part too: in stock carries no colour.
const HUE: Record<AvailabilityStatus, string> = {
  in_stock: 'var(--v2-mute)', out_of_stock: 'var(--v2-red)',
  incoming: 'var(--v2-amber)', special_order: 'var(--v2-t3)',
}

export function PartsManager({ productId }: { productId: string }) {
  const [parts, setParts] = useState<PartWithQr[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState | null>(null) // add form
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(empty)
  const [busy, setBusy] = useState(false)
  const { show, node: toast } = useToast()
  const { ask, dialog } = useConfirm()

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

  async function remove(part: PartWithQr) {
    if (!(await ask({
      title: 'Delete part',
      body: <>Deleting <b>{part.name || 'this part'}</b> removes it and its QR code. The product itself is untouched.</>,
      confirmLabel: 'Delete part',
      danger: true,
    }))) return
    const partId = part.id
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

  const renderFields = (f: FormState, set: (patch: Partial<FormState>) => void, key: string) => (
    <div className="v2-form">
      <div className="v2-fld wide"><label htmlFor={`pt-${key}-name`}>Part name</label><input id={`pt-${key}-name`} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Left armrest" /></div>
      <div className="v2-fld"><label htmlFor={`pt-${key}-price`}>Price</label><input id={`pt-${key}-price`} type="number" min={0} step="0.01" value={f.price} onChange={(e) => set({ price: e.target.value })} placeholder="—" /></div>
      <div className="v2-fld"><label htmlFor={`pt-${key}-avail`}>Availability</label><span className="v2-sel"><select id={`pt-${key}-avail`} value={f.availability_status} onChange={(e) => set({ availability_status: e.target.value as AvailabilityStatus })}>{AVAILABILITY_STATUSES.map((a) => <option key={a} value={a}>{AVAILABILITY_LABELS[a]}</option>)}</select></span></div>
      <div className="v2-fld"><label htmlFor={`pt-${key}-img`}>Photo (image URL)</label><input id={`pt-${key}-img`} value={f.image_url} onChange={(e) => set({ image_url: e.target.value })} placeholder="Paste a direct image URL" /></div>
      <div className="v2-fld"><label htmlFor={`pt-${key}-qty`}>Quantity</label><input id={`pt-${key}-qty`} type="number" min={0} value={f.quantity} onChange={(e) => set({ quantity: e.target.value })} /></div>
    </div>
  )

  return (
    <div style={{ marginTop: 30 }}>
      {toast}
      {dialog}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><i />Parts · {parts.length}</p>
        <s />
        {!form && <button onClick={() => setForm(empty)} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><Plus className="w-3.5 h-3.5" /> Add part</button>}
      </div>

      {form && (
        <div style={{ marginBottom: 24 }}>
          {renderFields(form, (patch) => setForm((s2) => ({ ...(s2 || empty), ...patch })), 'new')}
          <div className="v2-bar" style={{ marginTop: 18 }}>
            <button onClick={addPart} disabled={busy} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>Add part</button>
            <button onClick={() => setForm(null)} className="v2-act tap-target">Cancel</button>
          </div>
        </div>
      )}

      {loading ? <p className="v2-kick">Loading…</p> : parts.length === 0 && !form ? (
        <div className="v2-card" data-empty>
          <b>No parts yet</b>
          <span>Add the pieces this product is made of — each gets its own price, availability and QR code.</span>
        </div>
      ) : (
        <div className="v2-list">
          {parts.map((p) => editingId === p.id ? (
            <div key={p.id} style={{ padding: '16px 0' }}>
              {renderFields(editForm, (patch) => setEditForm((s2) => ({ ...s2, ...patch })), p.id)}
              <div className="v2-bar" style={{ marginTop: 18 }}>
                <button onClick={() => saveEdit(p.id)} disabled={busy} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>Save</button>
                <button onClick={() => setEditingId(null)} className="v2-act tap-target">Cancel</button>
              </div>
            </div>
          ) : (
            <div key={p.id} className="v2-row" style={{ ['--chan' as string]: HUE[p.availability_status] }}>
              {/* The same two frames as the product itself, at row size: what the part looks like and
                  the code that opens it. §35. */}
              <span className="v2-shot" style={{ ['--shot' as string]: '52px' }}>
                {p.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.image_url} alt="" />
                  : <i><Package /></i>}
              </span>
              <div className="v2-m">
                <p><span className="truncate">{p.name}</span><span className="v2-stat">{AVAILABILITY_LABELS[p.availability_status]}</span></p>
                <span>{p.price !== null ? `$${p.price.toLocaleString()} · ` : ''}Qty {p.quantity}</span>
              </div>
              {p.qr.dataUrl && (
                <span className="v2-shot" data-code style={{ ['--shot' as string]: '52px' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.qr.dataUrl} alt={`QR code for ${p.name}`} />
                </span>
              )}
              {/* The download is a control beside the code, not the code itself: an image that turns
                  out to be a button is a thing you have to discover. */}
              <div className="flex items-center gap-1 flex-none">
                {p.qr.dataUrl && (
                  <button onClick={() => downloadQr(p)} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-t2)' }} title="Download QR" aria-label={`Download the QR code for ${p.name}`}><Download /></button>
                )}
                <a href={p.qr.target} target="_blank" rel="noreferrer" title="Open public page" aria-label="Open public page" className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><ExternalLink /></a>
                <button onClick={() => startEdit(p)} className="v2-act tap-target">Edit</button>
                <button onClick={() => remove(p)} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }} title="Delete" aria-label={`Delete ${p.name}`}><Trash2 /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
