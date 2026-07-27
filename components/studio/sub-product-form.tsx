'use client'

import { useState } from 'react'
import type { StudioVariant } from '@/lib/studio/types'
import { FabricPicker, type FabricValue } from '@/components/studio/fabric-picker'

const input = 'h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{label}</span>{children}</label>
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
    <div className="space-y-3 rounded-lg border border-hairline-strong bg-sunken/40 p-3">
      {err && <p className="text-xs text-red-600">{err}</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="sm:col-span-2"><Field label="Name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2-seater" /></Field></div>
        <Field label="Price"><input className={input} type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="default = product" /></Field>
      </div>

      {/* Fabric selection — the new dropdown */}
      <div>
        <span className="mb-1 block text-xs font-semibold text-ink">Fabric</span>
        <FabricPicker value={fabric} onChange={setFabric} />
      </div>

      <Field label="Details"><textarea className="w-full rounded-lg border border-hairline-strong p-3 text-sm outline-none focus:border-accent" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything specific to this variant…" /></Field>

      {/* Photos */}
      <div>
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Photos</span>
        {photos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {photos.map((url, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-16 w-16 rounded-lg border border-hairline object-cover" />
                <button type="button" onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-xs text-white">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input className={input} value={photoDraft} onChange={(e) => setPhotoDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhoto() } }} placeholder="Paste an image URL and press +" />
          <button type="button" onClick={addPhoto} className="h-11 flex-shrink-0 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-ink hover:bg-white">+ Add</button>
        </div>
      </div>

      <Field label="SKU (optional)"><input className={input} value={sku} onChange={(e) => setSku(e.target.value)} /></Field>

      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : submitLabel}</button>
        <button onClick={onCancel} className="h-10 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-ink">Cancel</button>
      </div>
    </div>
  )
}
