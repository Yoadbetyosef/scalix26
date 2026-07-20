'use client'

import { useEffect, useState } from 'react'
import { Plus, Pencil, Archive, RotateCcw, QrCode } from 'lucide-react'
import { Drawer } from '@/components/ui/drawer'
import { QrPanel } from '@/components/commerce/component-images'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCents, centsToInput, inputToCents } from '@/lib/core/money-format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Variant { id: string; name: string; sku: string | null; price_override_cents: number | null; cost_cents: number | null; currency: string; status: string; track_inventory: boolean }
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { active: 'active', inactive: 'neutral', discontinued: 'closed' }

// A component's fabric/color/size VARIANTS (own SKU/price/cost/QR/inventory). Images have their own manager;
// attributes (fabric/dimensions) live in the component Attributes drawer.
export function ComponentCatalog({ componentId, componentName, onClose }: { componentId: string; componentName: string; onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} title={`${componentName} — variants`}>
      <ComponentVariants componentId={componentId} />
    </Drawer>
  )
}

export function ComponentVariants({ componentId }: { componentId: string }) {
  const [variants, setVariants] = useState<Variant[] | null>(null)
  const [editing, setEditing] = useState<Variant | 'new' | null>(null)
  const [qrFor, setQrFor] = useState<Variant | null>(null)
  const load = () => fetch(`/api/core/components/${componentId}/variants`).then((r) => r.json()).then((d) => setVariants(d.variants ?? [])).catch(() => setVariants([]))
  useEffect(() => { load() }, [componentId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(v: Variant, status: string) {
    const res = await fetch(`/api/core/variants/${v.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) })
    if (res.ok) load(); else toast.error('Could not update the variant.')
  }
  if (!variants) return <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
  return (
    <div>
      <div className="mb-3 flex items-center justify-between"><p className="text-sm text-muted">Fabric/color/size versions — each with its own SKU, price, cost and inventory.</p><Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add</Button></div>
      {variants.length === 0 ? <p className="py-6 text-center text-sm text-muted">No variants yet.</p> : (
        <ul className="space-y-2">
          {variants.map((v) => (
            <li key={v.id} className={cn('flex items-center gap-2 rounded-card border border-hairline bg-surface p-2.5 shadow-e1', v.status === 'discontinued' && 'opacity-60')}>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{v.name}</p><p className="truncate text-xs text-muted">{[v.sku, v.price_override_cents != null ? formatCents(v.price_override_cents, v.currency) : null].filter(Boolean).join(' · ') || 'No SKU'}</p></div>
              <Badge variant={STATUS_VARIANT[v.status] ?? 'neutral'}>{v.status}</Badge>
              <button onClick={() => setQrFor(v)} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="View QR" title="View QR"><QrCode className="h-4 w-4" /></button>
              <button onClick={() => setEditing(v)} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Edit" title="Edit"><Pencil className="h-4 w-4" /></button>
              {v.status === 'discontinued'
                ? <button onClick={() => setStatus(v, 'active')} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Restore"><RotateCcw className="h-4 w-4" /></button>
                : <button onClick={() => setStatus(v, 'discontinued')} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Archive"><Archive className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {editing && <VariantForm componentId={componentId} variant={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {qrFor && <Drawer open onClose={() => setQrFor(null)} title={`QR — ${qrFor.name}`}><QrPanel endpoint={`/api/core/variants/${qrFor.id}/qr`} /></Drawer>}
    </div>
  )
}

function VariantForm({ componentId, variant, onClose, onSaved }: { componentId: string; variant: Variant | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(variant?.name ?? '')
  const [sku, setSku] = useState(variant?.sku ?? '')
  const [price, setPrice] = useState(centsToInput(variant?.price_override_cents))
  const [cost, setCost] = useState(centsToInput(variant?.cost_cents))
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!name.trim()) { toast.error('Name is required.'); return }
    const p = inputToCents(price), c = inputToCents(cost)
    if (Number.isNaN(p) || Number.isNaN(c)) { toast.error('Enter valid amounts.'); return }
    setSaving(true)
    const body = { name: name.trim(), sku: sku.trim() || null, priceOverrideCents: p, costCents: c }
    const res = variant
      ? await fetch(`/api/core/variants/${variant.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch(`/api/core/components/${componentId}/variants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) { toast.success(variant ? 'Variant saved.' : 'Variant added.'); onSaved() } else toast.error(d.error || 'Could not save.')
  }
  return (
    <Drawer open onClose={onClose} title={variant ? 'Edit component variant' : 'Add component variant'} footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={save}>{variant ? 'Save' : 'Add'}</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Name <span className="text-danger">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Velvet / Emerald" maxLength={300} /></div>
        <div className="space-y-1.5"><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={200} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>Price (USD)</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" /></div>
          <div className="space-y-1.5"><Label>Cost (USD)</Label><Input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" /></div>
        </div>
      </div>
    </Drawer>
  )
}

