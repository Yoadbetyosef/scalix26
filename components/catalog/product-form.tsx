'use client'

import { useState } from 'react'
import { AVAILABILITY_STATUSES, AVAILABILITY_LABELS, PRODUCT_STATUSES, type CatalogProduct } from '@/lib/catalog/types'
import { FabricPicker, type FabricValue } from '@/components/studio/fabric-picker'
import { ProductNameField } from '@/components/catalog/product-name-field'
import { ProductCostCard, type CostDraft } from '@/components/catalog/product-cost-card'

export type ProductInput = Partial<CatalogProduct> & { tagsText?: string }

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
const area = 'w-full rounded-lg border border-hairline-strong p-3 text-sm outline-none focus:border-accent'

export function ProductForm({ initial, initialFabric, onSubmit, submitLabel, justCreated }: {
  initial?: Partial<CatalogProduct>
  initialFabric?: FabricValue
  /** Passed straight through to the cost card — see its own note. */
  justCreated?: boolean
  onSubmit: (p: Record<string, unknown>) => Promise<void>
  submitLabel: string
}) {
  const [f, setF] = useState<ProductInput>({
    name: '', sku: '', category: '', brand: '', description: '', measurements: '', fabric: '', price: null, status: 'active', availability_status: 'in_stock',
    showroom_quantity: 0, warehouse_quantity: 0, storage_quantity: 0, incoming_quantity: 0, expected_arrival_date: '',
    location_notes: '', ai_notes: '', internal_notes: '', image_url: '',
    ...initial,
    tagsText: (initial?.tags || []).join(', '),
  })
  // Cost typed on the Add form, held here until submit so it can be written with the product rather
  // than after it. Null means nothing was entered, which is an ordinary outcome.
  const [costDraft, setCostDraft] = useState<CostDraft | null>(null)
  const [fabric, setFabric] = useState<FabricValue>(initialFabric || {
    fabric_category: null, fabric_family: null, fabric_name: null, fabric_composition: null, fabric_durability: null,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof ProductInput, v: unknown) => setF((p) => ({ ...p, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await onSubmit({
        name: f.name, sku: f.sku, category: f.category, brand: f.brand, description: f.description,
        measurements: f.measurements, fabric: f.fabric,
        price: f.price === null || f.price === undefined || (f.price as unknown as string) === '' ? null : Number(f.price),
        status: f.status, availability_status: f.availability_status,
        showroom_quantity: Number(f.showroom_quantity) || 0, warehouse_quantity: Number(f.warehouse_quantity) || 0,
        storage_quantity: Number(f.storage_quantity) || 0, incoming_quantity: Number(f.incoming_quantity) || 0,
        expected_arrival_date: f.expected_arrival_date || null,
        location_notes: f.location_notes, ai_notes: f.ai_notes, internal_notes: f.internal_notes, image_url: f.image_url,
        tags: (f.tagsText || '').split(',').map((t) => t.trim()).filter(Boolean),
        ...fabric,
        // Only ever sent from the create form; an existing product's cost has its own endpoint.
        ...(initial?.id ? {} : { cost: costDraft }),
      })
    } catch (e2) { setErr((e2 as Error).message); setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</div>}

      {/* The essentials */}
      <section className="rounded-xl border border-hairline-strong bg-white p-4 space-y-3">
        {/* Suggests from the tenant's own product range and carries the category across. Free text is
            still accepted, so a piece that isn't on the list yet is never blocked. */}
        <Field label="Name">
          <ProductNameField
            className={input}
            value={f.name || ''}
            category={f.category ?? null}
            onChange={(patch) => setF((p) => ({ ...p, name: patch.name, ...(patch.category !== undefined ? { category: patch.category } : {}) }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><input className={input} value={f.category || ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Sofas" /></Field>
          <Field label="Price"><input className={input} type="number" step="0.01" value={f.price ?? ''} onChange={(e) => set('price', e.target.value)} placeholder="0.00" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Measurements"><input className={input} value={f.measurements || ''} onChange={(e) => set('measurements', e.target.value)} placeholder="e.g. W220 × D95 × H85 cm" /></Field>
          <Field label="Fabric"><input className={input} value={f.fabric || ''} onChange={(e) => set('fabric', e.target.value)} placeholder="e.g. Velvet · grey" /></Field>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-subtle">Photo</span>
          <div className="flex items-center gap-3">
            {f.image_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={f.image_url} alt="" className="h-16 w-16 flex-shrink-0 rounded-lg border border-hairline object-cover" />
              : <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-sunken text-xs text-muted">No photo</span>}
            <input className={input} value={f.image_url || ''} onChange={(e) => set('image_url', e.target.value)} placeholder="Paste an image URL" />
          </div>
        </div>
        <Field label="Description"><textarea className={area} rows={2} value={f.description || ''} onChange={(e) => set('description', e.target.value)} /></Field>
      </section>

      {/* Fabric */}
      <section className="rounded-xl border border-hairline-strong bg-white p-4 space-y-3">
        <h2 className="font-semibold text-ink">Fabric</h2>
        <FabricPicker value={fabric} onChange={setFabric} />
      </section>

      {/* Stock — the essentials for knowing what's on hand & what's coming */}
      <section className="rounded-xl border border-hairline-strong bg-white p-4 space-y-3">
        <h2 className="font-semibold text-ink">Stock</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Availability"><select className={input} value={f.availability_status} onChange={(e) => set('availability_status', e.target.value)}>{AVAILABILITY_STATUSES.map((s) => <option key={s} value={s}>{AVAILABILITY_LABELS[s]}</option>)}</select></Field>
          <Field label="In stock (qty)"><input className={input} type="number" min={0} value={f.showroom_quantity ?? 0} onChange={(e) => set('showroom_quantity', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Incoming qty" hint="Coming from the factory"><input className={input} type="number" min={0} value={f.incoming_quantity ?? 0} onChange={(e) => set('incoming_quantity', e.target.value)} /></Field>
          <Field label="Expected arrival"><input className={input} type="date" value={f.expected_arrival_date || ''} onChange={(e) => set('expected_arrival_date', e.target.value)} /></Field>
        </div>
      </section>

      {/* Cost & Margin — only once the product exists, since a cost row hangs off its id. On the create
          form there is nothing to attach it to yet, and a disabled card would be noise. The card also
          renders nothing at all unless this session is permitted to see costs; it asks the endpoint
          rather than being told, so there's no second copy of the rule here to fall out of date. */}
      {/* An existing product asks its own cost endpoint and saves on its own. A brand-new one has no
          id to hang a cost row off, so the card runs in draft mode and its values ride along with the
          product — written in one transaction, never as a second request that could fail on its own. */}
      {initial?.id
        ? <ProductCostCard productId={initial.id} justCreated={justCreated} />
        : <ProductCostCard draft={{ price: Number.isFinite(Number(f.price)) && String(f.price ?? '').trim() !== '' ? Number(f.price) : null, onChange: setCostDraft }} />}

      {/* Everything else, folded away */}
      <details className="rounded-xl border border-hairline-strong bg-white p-4">
        <summary className="cursor-pointer font-semibold text-ink">More (SKU, other locations, notes)</summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU"><input className={input} value={f.sku || ''} onChange={(e) => set('sku', e.target.value)} /></Field>
            <Field label="Brand"><input className={input} value={f.brand || ''} onChange={(e) => set('brand', e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Warehouse"><input className={input} type="number" min={0} value={f.warehouse_quantity ?? 0} onChange={(e) => set('warehouse_quantity', e.target.value)} /></Field>
            <Field label="Storage"><input className={input} type="number" min={0} value={f.storage_quantity ?? 0} onChange={(e) => set('storage_quantity', e.target.value)} /></Field>
            <Field label="Status"><select className={input} value={f.status} onChange={(e) => set('status', e.target.value)}>{PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          </div>
          <Field label="Location notes"><input className={input} value={f.location_notes || ''} onChange={(e) => set('location_notes', e.target.value)} placeholder="e.g. Aisle 4, bay B" /></Field>
          <Field label="Tags (comma-separated)"><input className={input} value={f.tagsText || ''} onChange={(e) => set('tagsText', e.target.value)} placeholder="sofa, leather, 3-seater" /></Field>
          <Field label="AI notes (what the AI may tell customers)"><textarea className={area} rows={2} value={f.ai_notes || ''} onChange={(e) => set('ai_notes', e.target.value)} /></Field>
          <Field label="Internal notes (staff only)"><textarea className={area} rows={2} value={f.internal_notes || ''} onChange={(e) => set('internal_notes', e.target.value)} /></Field>
        </div>
      </details>

      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button type="submit" disabled={busy} className="h-12 w-full rounded-lg bg-ink text-sm font-semibold text-white disabled:opacity-50 sm:w-auto sm:px-6">{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  )
}
