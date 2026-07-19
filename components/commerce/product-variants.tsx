'use client'

import { useEffect, useState } from 'react'
import { Plus, Layers, Pencil, Archive, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AttributeEditor } from '@/components/commerce/attribute-editor'
import { formatCents, centsToInput, inputToCents } from '@/lib/core/money-format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Variant { id: string; name: string; sku: string | null; price_override_cents: number | null; currency: string; status: string; track_inventory: boolean; image_url: string | null }
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { active: 'active', inactive: 'neutral', discontinued: 'closed' }

export function ProductVariants({ productId }: { productId: string }) {
  const [variants, setVariants] = useState<Variant[] | null>(null)
  const [editing, setEditing] = useState<Variant | 'new' | null>(null)
  const [attrsFor, setAttrsFor] = useState<Variant | null>(null)

  const load = () => fetch(`/api/core/products/${productId}/variants`).then((r) => r.json()).then((d) => setVariants(d.variants ?? [])).catch(() => setVariants([]))
  useEffect(() => { load() }, [productId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(v: Variant, status: string) {
    const res = await fetch(`/api/core/variants/${v.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) })
    if (res.ok) { toast.success(status === 'discontinued' ? 'Variant archived.' : 'Variant restored.'); load() } else toast.error('Could not update the variant.')
  }

  if (!variants) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">Sellable versions of this product (size, material, finish…). Distinct from components.</p>
        <Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add variant</Button>
      </div>

      {variants.length === 0 ? (
        <EmptyState icon={Layers} title="No variants yet" action={<Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add variant</Button>}>
          Add variants when a product ships in more than one version — each can carry its own SKU, price and inventory.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {variants.map((v) => (
            <li key={v.id} className={cn('flex items-center gap-3 rounded-card border border-hairline bg-surface p-3 shadow-e1', v.status === 'discontinued' && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{v.name}</p>
                <p className="truncate text-xs text-muted">{[v.sku, v.price_override_cents != null ? formatCents(v.price_override_cents, v.currency) : null].filter(Boolean).join(' · ') || 'No SKU'}</p>
              </div>
              <Badge variant={STATUS_VARIANT[v.status] ?? 'neutral'}>{v.status}</Badge>
              <button onClick={() => setAttrsFor(v)} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Attributes" title="Attributes"><SlidersHorizontal className="h-4 w-4" /></button>
              <button onClick={() => setEditing(v)} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
              {v.status === 'discontinued'
                ? <button onClick={() => setStatus(v, 'active')} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Restore"><RotateCcw className="h-4 w-4" /></button>
                : <button onClick={() => setStatus(v, 'discontinued')} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Archive"><Archive className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}

      {editing && <VariantForm productId={productId} variant={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {attrsFor && (
        <Drawer open onClose={() => setAttrsFor(null)} title={`Attributes — ${attrsFor.name}`}>
          <AttributeEditor endpoint={`/api/core/variants/${attrsFor.id}/attributes`} emptyHint="No variant attributes defined yet. Add variant fields in Settings → Custom fields." />
        </Drawer>
      )}
    </div>
  )
}

function VariantForm({ productId, variant, onClose, onSaved }: { productId: string; variant: Variant | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(variant?.name ?? '')
  const [sku, setSku] = useState(variant?.sku ?? '')
  const [price, setPrice] = useState(centsToInput(variant?.price_override_cents))
  const [trackInventory, setTrackInventory] = useState(variant?.track_inventory ?? true)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) { toast.error('Name is required.'); return }
    const cents = inputToCents(price)
    if (Number.isNaN(cents)) { toast.error('Enter a valid price.'); return }
    setSaving(true)
    const body = { name: name.trim(), sku: sku.trim() || null, priceOverrideCents: cents, trackInventory }
    const res = variant
      ? await fetch(`/api/core/variants/${variant.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch(`/api/core/products/${productId}/variants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) { toast.success(variant ? 'Variant saved.' : 'Variant added.'); onSaved() } else toast.error(d.error || 'Could not save the variant.')
  }

  return (
    <Drawer open onClose={onClose} title={variant ? 'Edit variant' : 'Add variant'}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={save}>{variant ? 'Save' : 'Add variant'}</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Name <span className="text-danger">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 3-seater, Oak" maxLength={300} /></div>
        <div className="space-y-1.5"><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optional" maxLength={200} /></div>
        <div className="space-y-1.5"><Label>Price override (USD)</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder="Leave blank to use base price" /></div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" /> Track inventory for this variant</label>
      </div>
    </Drawer>
  )
}
