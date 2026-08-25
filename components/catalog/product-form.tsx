'use client'

import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { ChevronRight, Package } from 'lucide-react'
import { AVAILABILITY_STATUSES, AVAILABILITY_LABELS, PRODUCT_STATUSES, type CatalogProduct } from '@/lib/catalog/types'
import { FabricPicker, type FabricValue } from '@/components/studio/fabric-picker'
import { ProductNameField } from '@/components/catalog/product-name-field'
import { ProductCostCard, type CostDraft } from '@/components/catalog/product-cost-card'

export type ProductInput = Partial<CatalogProduct> & { tagsText?: string }

// .v2-fld needs the label and the control as SIBLINGS — its label rule is a descendant selector, so
// v1's label-wrapping-input shape leaves the caption unstyled. Wrapping also loses nothing only
// because the id is put back here: the child is cloned with one derived from the caption, so every
// field keeps a real for/id association rather than relying on containment.
function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  const id = 'pf-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children
  return (
    <div className={wide ? 'v2-fld wide' : 'v2-fld'}>
      <label htmlFor={id}>{label}</label>
      {child}
      {hint && <span className="v2-hint">{hint}</span>}
    </div>
  )
}

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
    <form onSubmit={submit} style={{ display: 'grid', gap: 30 }}>
      {err && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)' }}>
          <span className="v2-chip-sq"><Package /></span>
          <p>{err}</p>
        </div>
      )}

      {/* THE ESSENTIALS. v1 gave each of the four groups its own bordered white card inside a page
          that was already a card — four boxes to say "these fields belong together", when a
          micro-label and a rule say it with one line. */}
      <section>
        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />The essentials</p><s /></div>
        <div className="v2-form">
          {/* Suggests from the tenant's own product range and carries the category across. Free text
              is still accepted, so a piece that isn't on the list yet is never blocked. */}
          <Field label="Name" wide>
            <ProductNameField
              value={f.name || ''}
              category={f.category ?? null}
              onChange={(patch) => setF((p) => ({ ...p, name: patch.name, ...(patch.category !== undefined ? { category: patch.category } : {}) }))}
            />
          </Field>
          <Field label="Category"><input value={f.category || ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Sofas" /></Field>
          <Field label="Price"><input type="number" step="0.01" value={f.price ?? ''} onChange={(e) => set('price', e.target.value)} placeholder="0.00" /></Field>
          <Field label="Measurements"><input value={f.measurements || ''} onChange={(e) => set('measurements', e.target.value)} placeholder="e.g. W220 × D95 × H85 cm" /></Field>
          <Field label="Fabric"><input value={f.fabric || ''} onChange={(e) => set('fabric', e.target.value)} placeholder="e.g. Velvet · grey" /></Field>

          {/* The photo field shows the frame the catalogue uses everywhere else, so what you are
              typing a URL into is visibly the same object the list and the detail screen will show. */}
          <div className="v2-fld wide">
            <label htmlFor="pf-photo">Photo</label>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
              <span className="v2-shot" style={{ ['--shot' as string]: '64px' }}>
                {f.image_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={f.image_url} alt="" />
                  : <i><Package /></i>}
              </span>
              <input id="pf-photo" value={f.image_url || ''} onChange={(e) => set('image_url', e.target.value)} placeholder="Paste an image URL" />
            </div>
          </div>

          <Field label="Description" wide><textarea rows={2} value={f.description || ''} onChange={(e) => set('description', e.target.value)} /></Field>
        </div>
      </section>

      <section>
        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><i />Fabric</p><s /></div>
        <FabricPicker value={fabric} onChange={setFabric} />
      </section>

      {/* Stock — the essentials for knowing what's on hand & what's coming */}
      <section>
        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Stock</p><s /></div>
        <div className="v2-form">
          <Field label="Availability">
            <span className="v2-sel">
              <select value={f.availability_status} onChange={(e) => set('availability_status', e.target.value)}>{AVAILABILITY_STATUSES.map((s2) => <option key={s2} value={s2}>{AVAILABILITY_LABELS[s2]}</option>)}</select>
            </span>
          </Field>
          <Field label="In stock (qty)"><input type="number" min={0} value={f.showroom_quantity ?? 0} onChange={(e) => set('showroom_quantity', e.target.value)} /></Field>
          <Field label="Incoming qty" hint="Coming from the factory"><input type="number" min={0} value={f.incoming_quantity ?? 0} onChange={(e) => set('incoming_quantity', e.target.value)} /></Field>
          <Field label="Expected arrival"><input type="date" value={f.expected_arrival_date || ''} onChange={(e) => set('expected_arrival_date', e.target.value)} /></Field>
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
      <details>
        <summary>
          <div className="v2-head" style={{ marginBottom: 0 }}>
            <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />More — SKU, other locations, notes</p>
            <s />
            <ChevronRight className="v2-fold-mark" />
          </div>
        </summary>
        <div className="v2-form" style={{ marginTop: 22 }}>
          <Field label="SKU"><input value={f.sku || ''} onChange={(e) => set('sku', e.target.value)} /></Field>
          <Field label="Brand"><input value={f.brand || ''} onChange={(e) => set('brand', e.target.value)} /></Field>
          <Field label="Warehouse"><input type="number" min={0} value={f.warehouse_quantity ?? 0} onChange={(e) => set('warehouse_quantity', e.target.value)} /></Field>
          <Field label="Storage"><input type="number" min={0} value={f.storage_quantity ?? 0} onChange={(e) => set('storage_quantity', e.target.value)} /></Field>
          <Field label="Status">
            <span className="v2-sel">
              <select value={f.status} onChange={(e) => set('status', e.target.value)}>{PRODUCT_STATUSES.map((s2) => <option key={s2} value={s2}>{s2}</option>)}</select>
            </span>
          </Field>
          <Field label="Location notes"><input value={f.location_notes || ''} onChange={(e) => set('location_notes', e.target.value)} placeholder="e.g. Aisle 4, bay B" /></Field>
          <Field label="Tags (comma-separated)" wide><input value={f.tagsText || ''} onChange={(e) => set('tagsText', e.target.value)} placeholder="sofa, leather, 3-seater" /></Field>
          <Field label="AI notes — what the AI may tell customers" wide><textarea rows={2} value={f.ai_notes || ''} onChange={(e) => set('ai_notes', e.target.value)} /></Field>
          <Field label="Internal notes — staff only" wide><textarea rows={2} value={f.internal_notes || ''} onChange={(e) => set('internal_notes', e.target.value)} /></Field>
        </div>
      </details>

      {/* The save bar stays stuck to the bottom of a phone screen, as it was — a long form whose only
          save is 900px down is a form people abandon. On a wide screen it is an ordinary pill. */}
      <div className="v2-savebar" data-pin>
        <button type="submit" disabled={busy} className="v2-act tap-target" data-solid data-wide>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  )
}
