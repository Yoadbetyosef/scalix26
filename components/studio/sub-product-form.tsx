'use client'

import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import type { StudioVariant } from '@/lib/studio/types'
import { FabricPicker, type FabricValue } from '@/components/studio/fabric-picker'

// Label and control as siblings, with the id cloned on — the same Field the two product forms use.
function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  const id = 'spv-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const child = isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children
  return (
    <div className={wide ? 'v2-fld wide' : 'v2-fld'}>
      <label htmlFor={id}>{label}</label>
      {child}
      {hint && <span className="v2-hint">{hint}</span>}
    </div>
  )
}

// A sub-product is a full product in its own right (name, photos, description, price) + a chosen fabric.
export function SubProductForm({ initial, onSubmit, submitLabel, onCancel }: {
  initial?: Partial<StudioVariant>
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
  submitLabel: string
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [price, setPrice] = useState<string>(initial?.price != null ? String(initial.price) : '')
  const [sku, setSku] = useState(initial?.sku || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [photos, setPhotos] = useState<string[]>(initial?.photos || [])
  const [photoDraft, setPhotoDraft] = useState('')
  const [fabric, setFabric] = useState<FabricValue>({
    fabric_category: initial?.fabric_category ?? null, fabric_family: initial?.fabric_family ?? null,
    fabric_name: initial?.fabric_name ?? null, fabric_composition: initial?.fabric_composition ?? null,
    fabric_durability: initial?.fabric_durability ?? null,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function addPhoto() { const u = photoDraft.trim(); if (!u) return; setPhotos((p) => [...p, u]); setPhotoDraft('') }

  async function submit() {
    setBusy(true); setErr(null)
    try {
      await onSubmit({ name, price: price === '' ? null : Number(price), sku, description, photos, ...fabric })
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <div>
      {err && <p className="v2-kick" style={{ color: 'var(--v2-red-ink)', marginBottom: 12 }}>{err}</p>}

      <div className="v2-form">
        <Field label="Name" wide><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2-seater" /></Field>
        <Field label="Price" hint="Leave blank to inherit the product's"><input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="—" /></Field>
        <Field label="SKU (optional)"><input value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
        <Field label="Details" wide><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything specific to this variant…" /></Field>
      </div>

      <div style={{ marginTop: 22 }}>
        <p className="v2-kick">Fabric</p>
        <FabricPicker value={fabric} onChange={setFabric} />
      </div>

      <div style={{ marginTop: 22 }}>
        <p className="v2-kick">Photos{photos.length ? ` · ${photos.length}` : ''}</p>
        {photos.length > 0 && (
          <div className="v2-shots" style={{ gap: 12, marginBottom: 16 }}>
            {photos.map((url, i) => (
              <div key={i} className="v2-shot" style={{ ['--shot' as string]: '64px', position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" />
                <button type="button" onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                        aria-label={`Remove photo ${i + 1}`} className="v2-ico"
                        style={{ ['--ghue' as string]: 'var(--v2-red)', position: 'absolute', right: -8, top: -8, background: 'var(--v2-paper)' }}><X /></button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          <div className="v2-fld" style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor="spv-photo">Add a photo</label>
            <input id="spv-photo" value={photoDraft} onChange={(e) => setPhotoDraft(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhoto() } }}
                   placeholder="Paste an image URL" />
          </div>
          <button type="button" onClick={addPhoto} disabled={!photoDraft.trim()} className="v2-act tap-target" style={{ marginBottom: 4 }}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      <div className="v2-bar" style={{ marginTop: 22 }}>
        <button onClick={submit} disabled={busy} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>{busy ? 'Saving…' : submitLabel}</button>
        <button onClick={onCancel} className="v2-act tap-target">Cancel</button>
      </div>
    </div>
  )
}
