'use client'

import { useState } from 'react'
import { STUDIO_PRODUCT_STATUSES, STUDIO_STATUS_LABELS, type StudioProduct } from '@/lib/studio/types'
import { FabricPicker, type FabricValue } from '@/components/studio/fabric-picker'

export type ProductInput = Partial<StudioProduct>

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}
const input = 'h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm outline-none focus:border-accent'

export function ProductForm({ initial, onSubmit, submitLabel }: { initial?: Partial<StudioProduct>; onSubmit: (p: Record<string, unknown>) => Promise<void>; submitLabel: string }) {
  const [f, setF] = useState<ProductInput>({
    name: '', category: '', description: '', base_price: null, status: 'active',
    photos: [], supplier_name: '', supplier_email: '', internal_notes: '', ...initial,
  })
  const [fabric, setFabric] = useState<FabricValue>({
    fabric_category: initial?.fabric_category ?? null, fabric_family: initial?.fabric_family ?? null,
    fabric_name: initial?.fabric_name ?? null, fabric_composition: initial?.fabric_composition ?? null,
    fabric_durability: initial?.fabric_durability ?? null,
  })
  const [photoDraft, setPhotoDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof ProductInput, v: unknown) => setF((p) => ({ ...p, [k]: v }))
  const photos = f.photos || []

  function addPhoto() {
    const url = photoDraft.trim()
    if (!url) return
    set('photos', [...photos, url]); setPhotoDraft('')
  }
  const removePhoto = (i: number) => set('photos', photos.filter((_, idx) => idx !== i))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await onSubmit({
        name: f.name, category: f.category, description: f.description,
        base_price: f.base_price === null || f.base_price === undefined || (f.base_price as unknown as string) === '' ? null : Number(f.base_price),
        status: f.status, photos,
        supplier_name: f.supplier_name, supplier_email: f.supplier_email, internal_notes: f.internal_notes,
        ...fabric,
      })
    } catch (e2) { setErr((e2 as Error).message); setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}

      {/* The essentials — this is all most products need. */}
      <section className="rounded-xl border border-hairline-strong bg-white p-4 space-y-3">
        <Field label="Name"><input className={input} required value={f.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Halden Lounge Chair" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Collection" hint="Optional — groups products"><input className={input} value={f.category || ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Nordic 2026" /></Field>
          <Field label="Base price"><input className={input} type="number" step="0.01" value={f.base_price ?? ''} onChange={(e) => set('base_price', e.target.value)} placeholder="0.00" /></Field>
        </div>
        <Field label="Details / spec"><textarea className="w-full rounded-lg border border-hairline-strong p-3 text-sm outline-none focus:border-accent" rows={3} value={f.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="Materials, dimensions, finish…" /></Field>
      </section>

      {/* Fabric (default for the product; sub-products can override) */}
      <section className="rounded-xl border border-hairline-strong bg-white p-4 space-y-3">
        <h2 className="font-semibold text-ink">Fabric</h2>
        <FabricPicker value={fabric} onChange={setFabric} />
      </section>

      {/* Photos */}
      <section className="rounded-xl border border-hairline-strong bg-white p-4 space-y-3">
        <h2 className="font-semibold text-ink">Photos</h2>
        {photos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {photos.map((url, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-20 w-20 rounded-lg border border-hairline object-cover" />
                <button type="button" onClick={() => removePhoto(i)} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-xs text-white">×</button>
                {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">Cover</span>}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input className={input} value={photoDraft} onChange={(e) => setPhotoDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhoto() } }} placeholder="Paste an image URL and press +" />
          <button type="button" onClick={addPhoto} className="h-11 flex-shrink-0 rounded-lg border border-hairline-strong px-4 text-sm font-medium text-ink hover:bg-sunken">+ Add</button>
        </div>
      </section>

      {/* Optional — supplier (used later by "Send to production") + status + internal notes */}
      <details className="rounded-xl border border-hairline-strong bg-white p-4">
        <summary className="cursor-pointer font-semibold text-ink">More (supplier, status, notes)</summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier name"><input className={input} value={f.supplier_name || ''} onChange={(e) => set('supplier_name', e.target.value)} /></Field>
            <Field label="Supplier email"><input className={input} type="email" value={f.supplier_email || ''} onChange={(e) => set('supplier_email', e.target.value)} placeholder="factory@example.com" /></Field>
          </div>
          <Field label="Status"><select className={input} value={f.status} onChange={(e) => set('status', e.target.value)}>{STUDIO_PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{STUDIO_STATUS_LABELS[s]}</option>)}</select></Field>
          <Field label="Internal notes (staff only)"><textarea className="w-full rounded-lg border border-hairline-strong p-3 text-sm outline-none focus:border-accent" rows={2} value={f.internal_notes || ''} onChange={(e) => set('internal_notes', e.target.value)} /></Field>
        </div>
      </details>

      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button type="submit" disabled={busy} className="h-12 w-full rounded-lg bg-ink text-sm font-semibold text-white disabled:opacity-50 sm:w-auto sm:px-6">{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  )
}
