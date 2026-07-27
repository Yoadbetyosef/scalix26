'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Package, Download } from 'lucide-react'
import { AVAILABILITY_LABELS, LOCATIONS, totalAvailable, type CatalogMovement, type CatalogProduct, type AvailabilityStatus, type MovementType } from '@/lib/catalog/types'
import { ProductForm } from '@/components/catalog/product-form'
import { StudioSections } from '@/components/studio/studio-sections'
import type { FabricValue } from '@/components/studio/fabric-picker'
import { useToast } from '@/components/admin/toast'

const badge: Record<AvailabilityStatus, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700', out_of_stock: 'bg-red-50 text-red-700',
  incoming: 'bg-amber-50 text-amber-700', special_order: 'bg-violet-50 text-violet-700',
}
const ACTIONS: { type: MovementType; label: string }[] = [
  { type: 'receive', label: 'Receive stock' }, { type: 'move', label: 'Move stock' },
  { type: 'adjust', label: 'Adjust quantity' }, { type: 'sell', label: 'Mark sold' }, { type: 'return', label: 'Return' },
]
const fmt = (iso: string) => { try { return new Date(iso).toLocaleString() } catch { return iso } }

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [product, setProduct] = useState<CatalogProduct | null>(null)
  const [movements, setMovements] = useState<CatalogMovement[]>([])
  const [qr, setQr] = useState<{ target: string; dataUrl: string | null } | null>(null)
  const [fabric, setFabric] = useState<FabricValue | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [move, setMove] = useState<null | { type: MovementType; quantity: string; from_location: string; to_location: string; note: string }>(null)
  const [busy, setBusy] = useState(false)
  const { show, node: toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/catalog/products/${id}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setProduct(d.product); setMovements(d.movements || []); setQr(d.qr); setFabric(d.fabric || null)
    } catch (e) { show((e as Error).message, 'err') } finally { setLoading(false) }
  }, [id, show])
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
    if (!product || !confirm('Mark this product inactive?')) return
    await saveEdit({ ...product, status: 'inactive', tags: product.tags })
  }

  function downloadQr() {
    if (!qr?.dataUrl) return
    const a = document.createElement('a'); a.href = qr.dataUrl; a.download = `${product?.sku || product?.name || 'product'}-qr.png`; a.click()
  }

  if (loading) return <div className="p-6 text-sm text-muted">Loading…</div>
  if (!product) return <div className="p-6 text-sm text-muted">Not found. <Link href="/catalog" className="text-accent-strong hover:underline">Back</Link></div>

  if (editing) return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      {toast}
      <button onClick={() => setEditing(false)} className="text-sm text-subtle hover:text-ink">← Cancel</button>
      <h1 className="mb-4 mt-2 text-2xl font-bold text-ink">Edit product</h1>
      <ProductForm initial={product} initialFabric={fabric || undefined} onSubmit={saveEdit} submitLabel="Save changes" />
    </div>
  )

  const loc = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 max-md:pb-24">
      {toast}
      <Link href="/catalog" className="text-sm text-subtle hover:text-ink">← Catalog</Link>

      {/* Summary */}
      <div className="mt-2 rounded-xl border border-hairline-strong bg-white p-4">
        <div className="flex gap-4">
          {product.image_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={product.image_url} alt="" className="h-24 w-24 flex-shrink-0 rounded-lg object-cover" />
            : <span className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-sunken text-muted"><Package className="h-7 w-7" /></span>}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-xl font-bold text-ink">{product.name}</h1>
              <button onClick={() => setEditing(true)} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken">Edit</button>
            </div>
            <p className="text-sm text-subtle">{product.sku || '—'}{product.brand ? ` · ${product.brand}` : ''}{product.category ? ` · ${product.category}` : ''}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge[product.availability_status]}`}>{AVAILABILITY_LABELS[product.availability_status]}</span>
              {product.price !== null && <span className="text-sm font-semibold text-ink">${product.price.toLocaleString()}</span>}
              {product.status !== 'active' && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-subtle capitalize">{product.status}</span>}
              {product.tags?.map((t) => <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent-strong">{t}</span>)}
            </div>
          </div>
        </div>
        {fabric?.fabric_name && (
          <p className="mt-3 text-sm text-subtle">
            <span className="font-medium text-ink">Fabric:</span> {[fabric.fabric_family, fabric.fabric_name].filter(Boolean).join(' · ')}
            {fabric.fabric_composition ? ` — ${fabric.fabric_composition}` : ''}
          </p>
        )}
        {product.description && <p className="mt-3 text-sm text-muted">{product.description}</p>}
      </div>

      {/* Studio experience — production/quote/invoice actions, sub-products, documents, customer page */}
      <StudioSections catalogId={id} />

      {/* Quantities */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[['Showroom', product.showroom_quantity], ['Warehouse', product.warehouse_quantity], ['Storage', product.storage_quantity], ['Incoming', product.incoming_quantity], ['Available', totalAvailable(product)]].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-hairline-strong bg-white p-3 text-center">
            <div className="text-xs uppercase tracking-wide text-subtle">{l}</div>
            <div className="text-xl font-bold text-ink">{v as number}</div>
          </div>
        ))}
      </div>
      {product.incoming_quantity > 0 && product.expected_arrival_date && <p className="mt-2 text-sm text-amber-600">Next shipment expected {product.expected_arrival_date}</p>}
      {product.location_notes && <p className="mt-1 text-sm text-muted">Location: {product.location_notes}</p>}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button key={a.type} onClick={() => setMove({ type: a.type, quantity: '1', from_location: 'showroom', to_location: a.type === 'receive' ? 'warehouse' : 'showroom', note: '' })} className="rounded-lg border border-hairline-strong px-3 py-2 text-sm font-medium text-ink hover:bg-sunken">{a.label}</button>
        ))}
        <button onClick={markInactive} className="rounded-lg border border-hairline-strong px-3 py-2 text-sm font-medium text-red-600 hover:bg-sunken">Mark inactive</button>
      </div>

      {/* Movement panel */}
      {move && (
        <div className="mt-3 rounded-xl border border-accent/30 bg-white p-4">
          <h3 className="mb-3 font-semibold text-ink capitalize">{move.type} stock</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block"><span className="mb-1 block text-xs text-subtle">Quantity</span><input type="number" min={0} value={move.quantity} onChange={(e) => setMove({ ...move, quantity: e.target.value })} className="h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm" /></label>
            {(move.type === 'move' || move.type === 'sell') && (
              <label className="block"><span className="mb-1 block text-xs text-subtle">From</span><select value={move.from_location} onChange={(e) => setMove({ ...move, from_location: e.target.value })} className="h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm">{LOCATIONS.map((l) => <option key={l} value={l}>{loc(l)}</option>)}</select></label>
            )}
            {(move.type === 'move' || move.type === 'receive' || move.type === 'return' || move.type === 'adjust') && (
              <label className="block"><span className="mb-1 block text-xs text-subtle">{move.type === 'adjust' ? 'Set location' : 'To'}</span><select value={move.to_location} onChange={(e) => setMove({ ...move, to_location: e.target.value })} className="h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm">{LOCATIONS.map((l) => <option key={l} value={l}>{loc(l)}</option>)}</select></label>
            )}
            <label className="block sm:col-span-1"><span className="mb-1 block text-xs text-subtle">Note</span><input value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} className="h-11 w-full rounded-lg border border-hairline-strong px-3 text-sm" /></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={submitMove} disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Apply</button>
            <button onClick={() => setMove(null)} className="rounded-lg border border-hairline-strong px-4 py-2 text-sm text-subtle">Cancel</button>
          </div>
        </div>
      )}

      {/* QR + history */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-hairline-strong bg-white p-4">
          <h3 className="mb-2 font-semibold text-ink">QR code</h3>
          {qr?.dataUrl ? (
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.dataUrl} alt="Product QR" className="h-28 w-28 rounded-lg border border-hairline" />
              <div>
                <p className="text-xs text-subtle break-all">Opens the product page for showroom/warehouse staff.</p>
                <button onClick={downloadQr} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken"><Download className="h-4 w-4" /> Download QR</button>
              </div>
            </div>
          ) : <p className="text-sm text-muted">QR unavailable.</p>}
        </div>
        <div className="rounded-xl border border-hairline-strong bg-white p-4">
          <h3 className="mb-2 font-semibold text-ink">Movement history</h3>
          {movements.length === 0 ? <p className="text-sm text-muted">No movements yet.</p> : (
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {movements.map((m) => (
                <li key={m.id} className="border-l-2 border-hairline pl-3 text-sm">
                  <div className="text-ink"><span className="font-medium capitalize">{m.movement_type}</span> {m.quantity}{m.from_location ? ` · from ${m.from_location}` : ''}{m.to_location ? ` → ${m.to_location}` : ''}</div>
                  <div className="text-xs text-subtle">{m.created_by || '—'} · {fmt(m.created_at)}{m.note ? ` · ${m.note}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
