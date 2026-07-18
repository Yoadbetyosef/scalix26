'use client'

import { useEffect, useState } from 'react'
import { Plus, Boxes, Pencil, Archive, RotateCcw, QrCode, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { formatCents, centsToInput, inputToCents } from '@/lib/core/money-format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Component { id: string; name: string; sku: string | null; quantity: number; price_cents: number | null; currency: string; status: string; notes: string | null; qr_code_token: string }
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { active: 'active', inactive: 'neutral', discontinued: 'closed' }

export function ProductComponents({ productId }: { productId: string }) {
  const [components, setComponents] = useState<Component[] | null>(null)
  const [editing, setEditing] = useState<Component | 'new' | null>(null)

  const load = () => fetch(`/api/core/products/${productId}/components`).then((r) => r.json()).then((d) => setComponents(d.components ?? [])).catch(() => setComponents([]))
  useEffect(() => { load() }, [productId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(cmp: Component, status: string) {
    const res = await fetch(`/api/core/components/${cmp.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status }) })
    if (res.ok) { toast.success(status === 'discontinued' ? 'Component archived.' : 'Component restored.'); load() } else toast.error('Could not update the component.')
  }

  if (!components) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">Physical pieces/parts that make up this product (each has its own QR page). Not sellable versions — that’s Variants.</p>
        <Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add component</Button>
      </div>

      {components.length === 0 ? (
        <EmptyState icon={Boxes} title="No components yet" action={<Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add component</Button>}>
          Add components to break a product into its physical pieces — each gets a scannable QR page for identification.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {components.map((cmp) => (
            <li key={cmp.id} className={cn('flex items-center gap-3 rounded-card border border-hairline bg-surface p-3 shadow-e1', cmp.status === 'discontinued' && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{cmp.name}</p>
                <p className="truncate text-xs text-muted">{[`×${cmp.quantity}`, cmp.sku, cmp.price_cents != null ? formatCents(cmp.price_cents, cmp.currency) : null].filter(Boolean).join(' · ')}</p>
              </div>
              <a href={`/p/${cmp.qr_code_token}`} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Public QR page" title="View public QR page"><QrCode className="h-4 w-4" /></a>
              <Badge variant={STATUS_VARIANT[cmp.status] ?? 'neutral'}>{cmp.status}</Badge>
              <button onClick={() => setEditing(cmp)} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
              {cmp.status === 'discontinued'
                ? <button onClick={() => setStatus(cmp, 'active')} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Restore"><RotateCcw className="h-4 w-4" /></button>
                : <button onClick={() => setStatus(cmp, 'discontinued')} className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle hover:bg-sunken hover:text-ink" aria-label="Archive"><Archive className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}

      {editing && <ComponentForm productId={productId} component={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </div>
  )
}

function ComponentForm({ productId, component, onClose, onSaved }: { productId: string; component: Component | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(component?.name ?? '')
  const [sku, setSku] = useState(component?.sku ?? '')
  const [quantity, setQuantity] = useState(String(component?.quantity ?? 1))
  const [price, setPrice] = useState(centsToInput(component?.price_cents))
  const [notes, setNotes] = useState(component?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) { toast.error('Name is required.'); return }
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) { toast.error('Quantity must be greater than 0.'); return }
    const cents = inputToCents(price)
    if (Number.isNaN(cents)) { toast.error('Enter a valid price.'); return }
    setSaving(true)
    const body = { name: name.trim(), sku: sku.trim() || null, quantity: qty, priceCents: cents, notes: notes.trim() || null }
    const res = component
      ? await fetch(`/api/core/components/${component.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch(`/api/core/products/${productId}/components`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok && d.ok) { toast.success(component ? 'Component saved.' : 'Component added.'); onSaved() } else toast.error(d.error || 'Could not save the component.')
  }

  return (
    <Drawer open onClose={onClose} title={component ? 'Edit component' : 'Add component'}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" loading={saving} onClick={save}>{component ? 'Save' : 'Add component'}</Button></div>}>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Name <span className="text-danger">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Left section, Base" maxLength={300} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optional" maxLength={200} /></div>
          <div className="space-y-1.5"><Label>Qty per product</Label><Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="1" step="1" inputMode="numeric" /></div>
        </div>
        <div className="space-y-1.5"><Label>Price (USD)</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder="Optional" /></div>
        <div className="space-y-1.5"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional" maxLength={2000} /></div>
        {component && (
          <a href={`/p/${component.qr_code_token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent-strong hover:underline"><ExternalLink className="h-4 w-4" /> View public QR page</a>
        )}
      </div>
    </Drawer>
  )
}
