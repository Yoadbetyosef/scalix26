'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { Package, Download, ChevronLeft } from 'lucide-react'
import { AVAILABILITY_LABELS, LOCATIONS, totalAvailable, type CatalogMovement, type CatalogProduct, type AvailabilityStatus, type MovementType } from '@/lib/catalog/types'
import { ProductForm } from '@/components/catalog/product-form'
import { StudioSections } from '@/components/studio/studio-sections'
import type { FabricValue } from '@/components/studio/fabric-picker'
import { PartsManager } from '@/components/catalog/parts-manager'
import { useToast } from '@/components/admin/toast'
import { useConfirm } from '@/components/v2/confirm'

// Same rule as the list: in stock is the absence of a problem and carries no colour, so a hue on
// this page means something is off the norm. One source of truth would be better still; it is
// duplicated rather than shared only because the list is a client page and this is too, and a third
// module for four strings is not worth the indirection.
const HUE: Record<AvailabilityStatus, string> = {
  in_stock: 'var(--v2-mute)', out_of_stock: 'var(--v2-red)',
  incoming: 'var(--v2-amber)', special_order: 'var(--v2-t3)',
}
const ACTIONS: { type: MovementType; label: string }[] = [
  { type: 'receive', label: 'Receive stock' }, { type: 'move', label: 'Move stock' },
  { type: 'adjust', label: 'Adjust quantity' }, { type: 'sell', label: 'Mark sold' }, { type: 'return', label: 'Return' },
]
const fmt = (iso: string) => { try { return new Date(iso).toLocaleString() } catch { return iso } }

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  // Arriving from "Create product". The form is behind an edit toggle and the cost card lives inside
  // it, so a product created a moment ago would land on a read-only page with nowhere to put its
  // cost. Read once, on mount, so it never fights the user's own use of the toggle afterwards.
  const justCreated = useSearchParams().get('created') === '1'
  const [product, setProduct] = useState<CatalogProduct | null>(null)
  const [movements, setMovements] = useState<CatalogMovement[]>([])
  const [qr, setQr] = useState<{ target: string; dataUrl: string | null } | null>(null)
  const [fabric, setFabric] = useState<FabricValue | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(justCreated)
  const [move, setMove] = useState<null | { type: MovementType; quantity: string; from_location: string; to_location: string; note: string }>(null)
  const [busy, setBusy] = useState(false)
  const { show, node: toast } = useToast()
  const { ask, dialog } = useConfirm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/catalog/products/${id}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setProduct(d.product); setMovements(d.movements || []); setQr(d.qr); setFabric(d.fabric || null)
    } catch (e) { show((e as Error).message, 'err') } finally { setLoading(false) }
  }, [id, show])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount
  useEffect(() => { load() }, [load])

  async function saveEdit(payload: Record<string, unknown>) {
    const res = await fetch(`/api/catalog/products/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error || 'Failed to save')
    setProduct(d.product); setEditing(false); show('Saved'); load()
  }

  async function submitMove() {
    if (!move) return
    setBusy(true)
    try {
      const res = await fetch(`/api/catalog/products/${id}/movement`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ movement_type: move.type, quantity: Number(move.quantity) || 0, from_location: move.from_location, to_location: move.to_location, note: move.note }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      setMove(null); show('Stock updated'); load()
    } catch (e) { show((e as Error).message, 'err') } finally { setBusy(false) }
  }

  async function markInactive() {
    if (!product) return
    if (!(await ask({
      title: 'Mark inactive',
      body: <>Marking <b>{product.name}</b> inactive takes it out of what the AI will quote. Nothing is deleted, and you can make it active again from Edit.</>,
      confirmLabel: 'Mark inactive',
    }))) return
    await saveEdit({ ...product, status: 'inactive', tags: product.tags })
  }

  function downloadQr() {
    if (!qr?.dataUrl) return
    const a = document.createElement('a'); a.href = qr.dataUrl; a.download = `${product?.sku || product?.name || 'product'}-qr.png`; a.click()
  }

  if (loading) return <div className="v2 v2-embedded p-4 sm:p-6"><p className="v2-kick">Loading…</p></div>
  if (!product) return (
    <div className="v2 v2-embedded p-4 sm:p-6">
      <div className="v2-card" data-empty>
        <b>That product isn’t here</b>
        <span>It may have been deleted. <Link href="/catalog" style={{ color: 'var(--v2-ink)', textDecoration: 'underline' }}>Back to the catalogue</Link>.</span>
      </div>
    </div>
  )

  if (editing) return (
    <div className="v2 v2-embedded mx-auto max-w-2xl p-4 sm:p-6">
      {toast}
      <div className="v2-head">
        <button onClick={() => setEditing(false)} className="v2-act tap-target"><ChevronLeft className="w-3.5 h-3.5" /> Cancel</button>
        <s />
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />Editing {product.name}</p>
      </div>
      <ProductForm initial={product} initialFabric={fabric || undefined} onSubmit={saveEdit} submitLabel="Save changes" justCreated={justCreated} />
    </div>
  )

  const loc = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  const hue = product.status === 'draft' ? 'var(--v2-t1)' : HUE[product.availability_status]
  return (
    <div className="v2 v2-embedded mx-auto max-w-3xl p-4 sm:p-6" style={{ paddingBottom: 'calc(24px + var(--v2-grab-h))' }}>
      {toast}
      {dialog}

      {/* THE HEADER. The product's name IS the page, so it is the one place on a migrated screen that
          keeps a real title — the rail says "Catalog", not which piece. Everything the summary card
          used to box up sits on the header's own line: the identifiers as the sub-line, the state and
          the price as chips beside them. */}
      <div className="v2-head">
        <Link href="/catalog" className="v2-act tap-target"><ChevronLeft className="w-3.5 h-3.5" /> Catalogue</Link>
        <s />
        <button onClick={() => setEditing(true)} className="v2-act tap-target" data-solid>Edit</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20, marginBottom: 26 }}>
        {/* The kit's media and code block — the photograph a person recognises and the code a phone
            reads, on one baseline. §35. */}
        <div className="v2-shots">
          <div className="v2-shot">
            <b>Photo</b>
            {product.image_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={product.image_url} alt={product.name} />
              : <i><Package /></i>}
          </div>
          {qr?.dataUrl && (
            <div className="v2-shot" data-code>
              <b>Scan</b>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.dataUrl} alt={`QR code for ${product.name}`} />
              <span>Opens this product for showroom and warehouse staff.</span>
              <button onClick={downloadQr} className="v2-act tap-target"><Download className="w-3.5 h-3.5" /> Download</button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--v2-ink)' }}>{product.name}</h1>
          <p className="v2-kick" style={{ marginTop: 8 }}>
            {product.sku || '—'}{product.brand ? ` · ${product.brand}` : ''}{product.category ? ` · ${product.category}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 12 }}>
            <span className="v2-stat" style={{ ['--chan' as string]: hue }}>{product.status === 'draft' ? 'Needs pricing' : AVAILABILITY_LABELS[product.availability_status]}</span>
            {product.price !== null && <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--v2-ink)', fontVariantNumeric: 'tabular-nums' }}>${product.price.toLocaleString()}</span>}
            {product.status !== 'active' && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)', textTransform: 'capitalize' }}>{product.status}</span>}
            {product.tags?.map((t) => <span key={t} className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t2)' }}>{t}</span>)}
          </div>
          {product.description && <p style={{ marginTop: 14, fontSize: 14.5, lineHeight: 1.5, color: 'var(--v2-ink-72)' }}>{product.description}</p>}

          {/* Fabric, measurements and location as the kit's fact list rather than three differently
              punctuated sentences. */}
          {(fabric?.fabric_name || product.measurements || product.fabric || product.location_notes) && (
            <dl className="v2-facts" data-narrow style={{ marginTop: 16 }}>
              {fabric?.fabric_name && (
                <div><dt>Fabric</dt><dd>{[fabric.fabric_family, fabric.fabric_name].filter(Boolean).join(' · ')}{fabric.fabric_composition ? ` — ${fabric.fabric_composition}` : ''}</dd></div>
              )}
              {product.measurements && <div><dt>Measurements</dt><dd>{product.measurements}</dd></div>}
              {product.fabric && <div><dt>Fabric note</dt><dd>{product.fabric}</dd></div>}
              {product.location_notes && <div><dt>Location</dt><dd>{product.location_notes}</dd></div>}
            </dl>
          )}
        </div>
      </div>

      {/* Studio experience — production/quote/invoice actions, sub-products, documents, customer page */}
      <StudioSections catalogId={id} />

      {/* WHERE THE STOCK IS. Five boxed tiles became five figures on one rule: the number is the
          content, the location is its mono label, and the last one is the sum of the rest so it is
          the one set apart. Same component as the totals under an order's line items. */}
      <div className="v2-head" style={{ marginTop: 30 }}>
        <p className="v2-kick" style={{ ['--ghue' as string]: hue }}><i />Where it is</p>
        <s />
        {product.incoming_quantity > 0 && product.expected_arrival_date && (
          <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-amber)' }}>Next shipment {product.expected_arrival_date}</span>
        )}
      </div>
      <dl className="v2-tot" style={{ justifyContent: 'flex-start', padding: 0 }}>
        {([['Showroom', product.showroom_quantity], ['Warehouse', product.warehouse_quantity], ['Storage', product.storage_quantity], ['Incoming', product.incoming_quantity]] as [string, number][]).map(([l, v]) => (
          <div key={l}><dt>{l}</dt><dd>{v}</dd></div>
        ))}
        <div><dt>Available</dt><dd style={{ fontWeight: 650 }}>{totalAvailable(product)}</dd></div>
      </dl>

      {/* The stock verbs. The separator marks where reversible stops: everything after it changes
          what the AI will quote. */}
      <div className="v2-bar" style={{ marginTop: 20 }}>
        {ACTIONS.map((a) => (
          <button key={a.type} onClick={() => setMove({ type: a.type, quantity: '1', from_location: 'showroom', to_location: a.type === 'receive' ? 'warehouse' : 'showroom', note: '' })} className="v2-act tap-target">{a.label}</button>
        ))}
        <hr />
        <button onClick={markInactive} className="v2-act tap-target" data-danger>Mark inactive</button>
      </div>

      {/* Movement panel */}
      {move && (
        <div style={{ marginTop: 24 }}>
          <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t2)', textTransform: 'uppercase' }}><i />{move.type} stock</p><s /></div>
          <div className="v2-form">
            <div className="v2-fld"><label htmlFor="mv-qty">Quantity</label><input id="mv-qty" type="number" min={0} value={move.quantity} onChange={(e) => setMove({ ...move, quantity: e.target.value })} /></div>
            {(move.type === 'move' || move.type === 'sell') && (
              <div className="v2-fld"><label htmlFor="mv-from">From</label><span className="v2-sel"><select id="mv-from" value={move.from_location} onChange={(e) => setMove({ ...move, from_location: e.target.value })}>{LOCATIONS.map((l) => <option key={l} value={l}>{loc(l)}</option>)}</select></span></div>
            )}
            {(move.type === 'move' || move.type === 'receive' || move.type === 'return' || move.type === 'adjust') && (
              <div className="v2-fld"><label htmlFor="mv-to">{move.type === 'adjust' ? 'Set location' : 'To'}</label><span className="v2-sel"><select id="mv-to" value={move.to_location} onChange={(e) => setMove({ ...move, to_location: e.target.value })}>{LOCATIONS.map((l) => <option key={l} value={l}>{loc(l)}</option>)}</select></span></div>
            )}
            <div className="v2-fld"><label htmlFor="mv-note">Note</label><input id="mv-note" value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} /></div>
          </div>
          <div className="v2-bar" style={{ marginTop: 18 }}>
            <button onClick={submitMove} disabled={busy} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>Apply</button>
            <button onClick={() => setMove(null)} className="v2-act tap-target">Cancel</button>
          </div>
        </div>
      )}

      {/* MOVEMENT HISTORY. Its own section rather than half of a two-card grid — the QR left that
          grid to join the photo, and what remained was one card sized for a column that no longer
          had a partner. */}
      <div className="v2-head" style={{ marginTop: 30 }}>
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />Movement history</p><s />
      </div>
      {movements.length === 0 ? (
        <div className="v2-card" data-empty>
          <b>Nothing has moved yet</b>
          <span>Receiving, moving, selling or returning stock is recorded here with who did it and when.</span>
        </div>
      ) : (
        <div className="v2-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
          {movements.map((m) => (
            <div key={m.id} className="v2-row" style={{ ['--chan' as string]: 'var(--v2-t4)' }}>
              <div className="v2-m">
                <p><span style={{ textTransform: 'capitalize' }}>{m.movement_type}</span> {m.quantity}{m.from_location ? ` · from ${m.from_location}` : ''}{m.to_location ? ` → ${m.to_location}` : ''}</p>
                <span>{m.created_by || '—'} · {fmt(m.created_at)}{m.note ? ` · ${m.note}` : ''}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Parts / pieces of this product */}
      <PartsManager productId={id} />
    </div>
  )
}
