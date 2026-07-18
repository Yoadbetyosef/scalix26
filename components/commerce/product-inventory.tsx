'use client'

import { useEffect, useState } from 'react'
import { Warehouse, Plus, ArrowRightLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

interface Level { location_id: string; on_hand: number; reserved: number; available: number }
interface Location { id: string; name: string; kind: string }
const MOVEMENTS = ['receive', 'reserve', 'release', 'allocate', 'ship', 'return', 'adjust'] as const

export function ProductInventory({ productId }: { productId: string }) {
  const [data, setData] = useState<{ levels: Level[]; locations: Location[] } | null>(null)
  const [moving, setMoving] = useState(false)
  const [addingLocation, setAddingLocation] = useState(false)

  const load = () => fetch(`/api/core/inventory/levels?itemKind=product&itemId=${productId}`).then((r) => r.json()).then(setData).catch(() => setData({ levels: [], locations: [] }))
  useEffect(() => { load() }, [productId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>

  const byLoc = new Map(data.levels.map((l) => [l.location_id, l]))

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-sm text-muted">Stock tracked in the Core ledger. Every change is an audited movement — counts are never edited directly.</p>
        {data.locations.length > 0 && <Button size="sm" onClick={() => setMoving(true)}><ArrowRightLeft className="h-4 w-4" /> Move stock</Button>}
      </div>

      {data.locations.length === 0 ? (
        <EmptyState icon={Warehouse} title="No stock locations yet" action={<Button size="sm" onClick={() => setAddingLocation(true)}><Plus className="h-4 w-4" /> Add location</Button>}>
          Add a location (warehouse, showroom, …) to start tracking this product’s inventory.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-card border border-hairline bg-surface shadow-e1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Location</th><th className="px-4 py-3 font-medium">On hand</th><th className="px-4 py-3 font-medium">Reserved</th><th className="px-4 py-3 font-medium">Available</th>
              </tr>
            </thead>
            <tbody>
              {data.locations.map((loc) => {
                const lv = byLoc.get(loc.id)
                return (
                  <tr key={loc.id} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-3 text-ink">{loc.name}</td>
                    <td className="px-4 py-3 text-subtle">{lv ? Number(lv.on_hand) : 0}</td>
                    <td className="px-4 py-3 text-subtle">{lv ? Number(lv.reserved) : 0}</td>
                    <td className="px-4 py-3 font-medium text-ink">{lv ? Number(lv.available) : 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-hairline p-2"><Button variant="ghost" size="sm" onClick={() => setAddingLocation(true)}><Plus className="h-4 w-4" /> Add location</Button></div>
        </div>
      )}

      {moving && <MoveForm productId={productId} locations={data.locations} onClose={() => setMoving(false)} onDone={() => { setMoving(false); load() }} />}
      {addingLocation && <AddLocationForm onClose={() => setAddingLocation(false)} onDone={() => { setAddingLocation(false); load() }} />}
    </div>
  )
}

function MoveForm({ productId, locations, onClose, onDone }: { productId: string; locations: Location[]; onClose: () => void; onDone: () => void }) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [movement, setMovement] = useState<string>('receive')
  const [quantity, setQuantity] = useState('1')
  const [saving, setSaving] = useState(false)

  async function submit() {
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || (movement !== 'adjust' && qty <= 0) || qty < 0) { toast.error('Enter a valid quantity.'); return }
    if (!locationId) { toast.error('Choose a location.'); return }
    setSaving(true)
    const res = await fetch('/api/core/inventory/move', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemKind: 'product', itemId: productId, locationId, movement, quantity: qty }) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) { toast.success(`Available: ${d.available ?? '—'}`); onDone() } else toast.error(errorLabel(d.error) || 'Movement failed.')
  }

  return (
    <Drawer open onClose={onClose} title="Move stock"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={submit}>Apply</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Location</Label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5"><Label>Movement</Label>
          <select value={movement} onChange={(e) => setMovement(e.target.value)} className="h-11 w-full rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">
            {MOVEMENTS.map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
          </select>
        </div>
        <div className="space-y-1.5"><Label>{movement === 'adjust' ? 'Set on-hand to' : 'Quantity'}</Label><Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="0" step="1" inputMode="numeric" /></div>
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
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) { toast.success('Location added.'); onDone() } else toast.error('Could not add the location.')
  }
  return (
    <Drawer open onClose={onClose} title="Add location"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={submit}>Add</Button></div>}>
      <div className="space-y-1.5"><Label>Name <span className="text-danger">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main warehouse" maxLength={200} /></div>
    </Drawer>
  )
}

function errorLabel(e?: string): string | null {
  if (!e) return null
  if (e === 'insufficient_available') return 'Not enough available to reserve.'
  if (e === 'insufficient_reserved') return 'Not enough reserved to allocate.'
  return e
}
