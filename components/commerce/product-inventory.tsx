'use client'

import { useEffect, useState } from 'react'
import { Warehouse, Plus, ArrowRightLeft, Truck, Check, X, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

interface Level { location_id: string; on_hand: number; reserved: number; available: number }
interface Location { id: string; name: string; kind: string }
interface Incoming { id: string; location_id: string | null; quantity: number; expected_arrival_date: string | null; supplier_ref: string | null; po_ref: string | null; notes: string | null; status: string }
interface Summary { onHand: number; reserved: number; available: number; incoming: number; nextArrival: string | null }
interface Meta { availability_status: string | null; low_stock_threshold: number; ai_notes: string | null; internal_notes: string | null; location_notes: string | null }
interface ItemInv { levels: Level[]; locations: Location[]; incoming: Incoming[]; summary: Summary; meta: Meta; availability: string; rollup: Summary | null }
interface Ledger { id: string; movement: string; quantity: number; on_hand_after: number | null; reserved_after: number | null; reason: string | null; created_at: string }

const MOVEMENTS = ['receive', 'reserve', 'release', 'allocate', 'ship', 'return', 'adjust'] as const
export const AVAILABILITY: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  in_stock: { label: 'In stock', variant: 'active' }, low_stock: { label: 'Low stock', variant: 'pending' }, out_of_stock: { label: 'Out of stock', variant: 'closed' },
  incoming: { label: 'Incoming', variant: 'open' }, made_to_order: { label: 'Made to order', variant: 'neutral' }, discontinued: { label: 'Discontinued', variant: 'closed' },
}
const day = (d: string | null) => (d ? String(d).slice(0, 10) : null)

export function ProductInventory({ productId }: { productId: string }) {
  return <InventoryPanel itemKind="product" itemId={productId} />
}

// Generic Core inventory panel for any item kind (product / variant / component). Same data + capabilities
// everywhere. Every stock change goes through the atomic core_inventory_move RPC; counts are never edited.
export function InventoryPanel({ itemKind, itemId }: { itemKind: 'product' | 'variant' | 'component'; itemId: string }) {
  const [data, setData] = useState<ItemInv | null>(null)
  const [ledger, setLedger] = useState<Ledger[] | null>(null)
  const [moving, setMoving] = useState(false)
  const [addingLocation, setAddingLocation] = useState(false)
  const [addingIncoming, setAddingIncoming] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const load = () => fetch(`/api/core/inventory/item?itemKind=${itemKind}&itemId=${itemId}`).then((r) => r.json()).then(setData).catch(() => setData(null))
  const loadLedger = () => fetch(`/api/core/inventory/history?itemKind=${itemKind}&itemId=${itemId}`).then((r) => r.json()).then((d) => setLedger(d.ledger ?? [])).catch(() => setLedger([]))
  useEffect(() => { load() }, [itemKind, itemId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveMeta(patch: Record<string, unknown>) {
    const res = await fetch('/api/core/inventory/meta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemKind, itemId, ...patch }) })
    if (res.ok) load(); else toast.error('Could not save.')
  }
  async function incomingAction(id: string, action: 'receive' | 'cancel') {
    const res = await fetch(`/api/core/inventory/incoming/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) { toast.success(action === 'receive' ? 'Shipment received into stock.' : 'Shipment cancelled.'); load() }
    else toast.error(d.error === 'no_location' ? 'Set a location on the shipment to receive it.' : 'Action failed.')
  }

  if (!data) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
  const byLoc = new Map(data.levels.map((l) => [l.location_id, l]))
  const av = AVAILABILITY[data.availability] ?? { label: data.availability, variant: 'neutral' as const }
  const locName = (id: string | null) => data.locations.find((l) => l.id === id)?.name ?? '—'

  return (
    <div className="space-y-5">
      {/* Availability + summary */}
      <div className="rounded-card border border-hairline bg-surface p-4 shadow-e1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Badge variant={av.variant}>{av.label}</Badge>{data.summary.incoming > 0 && <span className="text-xs text-muted">· {data.summary.incoming} incoming{data.summary.nextArrival ? ` · expected ${data.summary.nextArrival}` : ''}</span>}</div>
          <select value={data.meta.availability_status ?? ''} onChange={(e) => saveMeta({ availability_status: e.target.value || null })} className="h-8 rounded-input border border-hairline bg-white px-2 text-xs text-ink focus:border-ink/30 focus:outline-none" title="Availability (Auto derives from stock)">
            <option value="">Auto (from stock)</option>
            {Object.entries(AVAILABILITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="On hand" value={data.summary.onHand} />
          <Stat label="Reserved" value={data.summary.reserved} />
          <Stat label="Available" value={data.summary.available} strong />
          <Stat label="Incoming" value={data.summary.incoming} />
        </div>
        {data.rollup && (data.rollup.onHand !== data.summary.onHand || data.rollup.available !== data.summary.available) && (
          <p className="mt-2 text-xs text-muted">Including variants: {data.rollup.onHand} on hand · {data.rollup.available} available · {data.rollup.incoming} incoming</p>
        )}
      </div>

      {/* Per-location levels */}
      <div>
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-medium text-ink">Stock by location</h3>{data.locations.length > 0 && <Button size="sm" variant="outline" onClick={() => setMoving(true)}><ArrowRightLeft className="h-4 w-4" /> Move stock</Button>}</div>
        {data.locations.length === 0 ? (
          <EmptyState icon={Warehouse} title="No stock locations yet" action={<Button size="sm" onClick={() => setAddingLocation(true)}><Plus className="h-4 w-4" /> Add location</Button>}>Add a location (warehouse, showroom, storage…) to start tracking stock.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-card border border-hairline bg-surface shadow-e1">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted"><th className="px-4 py-2.5 font-medium">Location</th><th className="px-4 py-2.5 font-medium">On hand</th><th className="px-4 py-2.5 font-medium">Reserved</th><th className="px-4 py-2.5 font-medium">Available</th></tr></thead>
              <tbody>{data.locations.map((loc) => { const lv = byLoc.get(loc.id); return (
                <tr key={loc.id} className="border-b border-hairline last:border-0"><td className="px-4 py-2.5 text-ink">{loc.name}</td><td className="px-4 py-2.5 text-subtle">{lv ? Number(lv.on_hand) : 0}</td><td className="px-4 py-2.5 text-subtle">{lv ? Number(lv.reserved) : 0}</td><td className="px-4 py-2.5 font-medium text-ink">{lv ? Number(lv.available) : 0}</td></tr>
              ) })}</tbody>
            </table>
            <div className="border-t border-hairline p-2"><Button variant="ghost" size="sm" onClick={() => setAddingLocation(true)}><Plus className="h-4 w-4" /> Add location</Button></div>
          </div>
        )}
      </div>

      {/* Incoming shipments */}
      <div>
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-medium text-ink">Incoming shipments</h3><Button size="sm" variant="outline" onClick={() => setAddingIncoming(true)}><Truck className="h-4 w-4" /> Add incoming</Button></div>
        {data.incoming.filter((i) => i.status !== 'cancelled').length === 0 ? <p className="rounded-card border border-dashed border-hairline-strong px-4 py-4 text-center text-sm text-muted">No incoming shipments. Add one when stock is on the way.</p> : (
          <ul className="space-y-2">{data.incoming.filter((i) => i.status !== 'cancelled').map((inc) => (
            <li key={inc.id} className="flex items-center justify-between gap-3 rounded-card border border-hairline bg-surface p-3 text-sm shadow-e1">
              <div className="min-w-0">
                <p className="font-medium text-ink">{inc.quantity} incoming{inc.expected_arrival_date ? ` · expected ${day(inc.expected_arrival_date)}` : ''} {inc.status === 'received' && <Badge variant="active">received</Badge>}</p>
                <p className="truncate text-xs text-muted">{[locName(inc.location_id), inc.supplier_ref && `Supplier ${inc.supplier_ref}`, inc.po_ref && `PO ${inc.po_ref}`, inc.notes].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              {inc.status === 'expected' && <div className="flex shrink-0 gap-1"><button onClick={() => incomingAction(inc.id, 'receive')} className="inline-flex items-center gap-1 rounded-lg border border-hairline-strong px-2 py-1 text-xs text-ink hover:bg-sunken" title="Receive into stock"><Check className="h-3.5 w-3.5" /> Receive</button><button onClick={() => incomingAction(inc.id, 'cancel')} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-subtle hover:text-danger" title="Cancel"><X className="h-3.5 w-3.5" /></button></div>}
            </li>
          ))}</ul>
        )}
      </div>

      {/* Notes */}
      <div className="grid gap-3 sm:grid-cols-2">
        <NoteBox label="AI customer-facing notes" hint="The AI may share these" defaultValue={data.meta.ai_notes} onSave={(v) => saveMeta({ ai_notes: v })} />
        <NoteBox label="Internal notes" hint="Never shared" defaultValue={data.meta.internal_notes} onSave={(v) => saveMeta({ internal_notes: v })} />
        <div className="sm:col-span-2"><NoteBox label="Location notes" hint="Where stock physically sits" defaultValue={data.meta.location_notes} onSave={(v) => saveMeta({ location_notes: v })} /></div>
      </div>

      {/* History */}
      <div>
        <Button size="sm" variant="ghost" onClick={() => { setShowHistory((s) => !s); if (!ledger) loadLedger() }}><History className="h-4 w-4" /> {showHistory ? 'Hide' : 'Show'} inventory history</Button>
        {showHistory && (ledger === null ? <Skeleton className="mt-2 h-20 w-full" /> : ledger.length === 0 ? <p className="mt-2 text-sm text-muted">No movements yet.</p> : (
          <ul className="mt-2 space-y-1 text-xs">{ledger.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded border border-hairline bg-surface px-3 py-1.5"><span className="text-ink">{m.movement} <span className="text-muted">{Number(m.quantity)}</span></span><span className="text-muted">{m.on_hand_after != null ? `on hand ${Number(m.on_hand_after)}` : ''} · {new Date(m.created_at).toLocaleDateString()}</span></li>
          ))}</ul>
        ))}
      </div>

      {moving && <MoveForm itemKind={itemKind} itemId={itemId} locations={data.locations} onClose={() => setMoving(false)} onDone={() => { setMoving(false); load() }} />}
      {addingLocation && <AddLocationForm onClose={() => setAddingLocation(false)} onDone={() => { setAddingLocation(false); load() }} />}
      {addingIncoming && <IncomingForm itemKind={itemKind} itemId={itemId} locations={data.locations} onClose={() => setAddingIncoming(false)} onDone={() => { setAddingIncoming(false); load() }} />}
    </div>
  )
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return <div className="rounded-lg bg-sunken px-3 py-2"><p className="text-xs text-muted">{label}</p><p className={strong ? 'text-lg font-semibold text-ink' : 'text-lg text-ink'}>{value}</p></div>
}
function NoteBox({ label, hint, defaultValue, onSave }: { label: string; hint: string; defaultValue: string | null; onSave: (v: string | null) => void }) {
  return <div className="space-y-1"><Label className="text-xs">{label} <span className="font-normal text-muted">· {hint}</span></Label><Textarea defaultValue={defaultValue ?? ''} rows={2} maxLength={4000} onBlur={(e) => onSave(e.target.value.trim() || null)} placeholder="—" /></div>
}

function MoveForm({ itemKind, itemId, locations, onClose, onDone }: { itemKind: string; itemId: string; locations: Location[]; onClose: () => void; onDone: () => void }) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [movement, setMovement] = useState<string>('receive')
  const [quantity, setQuantity] = useState('1')
  const [saving, setSaving] = useState(false)
  async function submit() {
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || (movement !== 'adjust' && qty <= 0) || qty < 0) { toast.error('Enter a valid quantity.'); return }
    if (!locationId) { toast.error('Choose a location.'); return }
    setSaving(true)
    const res = await fetch('/api/core/inventory/move', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemKind, itemId, locationId, movement, quantity: qty }) })
    const d = await res.json().catch(() => ({})); setSaving(false)
    if (res.ok && d.ok) { toast.success(`Available: ${d.available ?? '—'}`); onDone() } else toast.error(errorLabel(d.error) || 'Movement failed.')
  }
  return (
    <Drawer open onClose={onClose} title="Move stock" footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={submit}>Apply</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Location</Label><select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div className="space-y-1.5"><Label>Movement</Label><select value={movement} onChange={(e) => setMovement(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">{MOVEMENTS.map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}</select></div>
        <div className="space-y-1.5"><Label>{movement === 'adjust' ? 'Set on-hand to' : 'Quantity'}</Label><Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="0" step="1" inputMode="numeric" /></div>
      </div>
    </Drawer>
  )
}

function IncomingForm({ itemKind, itemId, locations, onClose, onDone }: { itemKind: string; itemId: string; locations: Location[]; onClose: () => void; onDone: () => void }) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [quantity, setQuantity] = useState('1')
  const [expected, setExpected] = useState('')
  const [supplier, setSupplier] = useState('')
  const [po, setPo] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit() {
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) { toast.error('Enter a valid quantity.'); return }
    setSaving(true)
    const res = await fetch('/api/core/inventory/incoming', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemKind, itemId, locationId: locationId || null, quantity: qty, expectedArrivalDate: expected || null, supplierRef: supplier.trim() || null, poRef: po.trim() || null, notes: notes.trim() || null }) })
    const d = await res.json().catch(() => ({})); setSaving(false)
    if (res.ok && d.ok) { toast.success('Incoming shipment added.'); onDone() } else toast.error(d.error || 'Could not add the shipment.')
  }
  return (
    <Drawer open onClose={onClose} title="Add incoming shipment" footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={submit}>Add</Button></div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Quantity</Label><Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="1" step="1" /></div>
          <div className="space-y-1.5"><Label>Expected arrival</Label><Input value={expected} onChange={(e) => setExpected(e.target.value)} type="date" /></div>
        </div>
        <div className="space-y-1.5"><Label>Destination location</Label><select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none"><option value="">— unassigned —</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select><p className="text-xs text-muted">Needed to receive it into stock later.</p></div>
        <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Supplier ref</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Optional" maxLength={300} /></div><div className="space-y-1.5"><Label>PO ref</Label><Input value={po} onChange={(e) => setPo(e.target.value)} placeholder="Optional" maxLength={300} /></div></div>
        <div className="space-y-1.5"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" maxLength={2000} /></div>
      </div>
    </Drawer>
  )
}

function AddLocationForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit() {
    if (!name.trim()) { toast.error('Name is required.'); return }
    setSaving(true)
    const res = await fetch('/api/core/inventory/locations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) })
    const d = await res.json().catch(() => ({})); setSaving(false)
    if (res.ok && d.ok) { toast.success('Location added.'); onDone() } else toast.error('Could not add the location.')
  }
  return (
    <Drawer open onClose={onClose} title="Add location" footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={submit}>Add</Button></div>}>
      <div className="space-y-1.5"><Label>Name <span className="text-danger">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Showroom, Warehouse, Storage" maxLength={200} /></div>
    </Drawer>
  )
}

function errorLabel(e?: string): string | null {
  if (!e) return null
  if (e === 'insufficient_available') return 'Not enough available to reserve.'
  if (e === 'insufficient_reserved') return 'Not enough reserved to allocate.'
  return e
}
