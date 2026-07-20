'use client'

import { useEffect, useState } from 'react'
import { Plus, Boxes, Pencil, Archive, RotateCcw, QrCode, ExternalLink, SlidersHorizontal, Layers, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Menu, type MenuItem } from '@/components/ui/menu'
import { ComponentDetail } from '@/components/commerce/component-detail'
import { formatCents, centsToInput, inputToCents } from '@/lib/core/money-format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Component { id: string; name: string; sku: string | null; quantity: number; price_cents: number | null; cost_cents: number | null; currency: string; status: string; notes: string | null; description: string | null; component_type: string | null; track_inventory: boolean; qr_code_token: string; image_url: string | null; category: string | null; use_parent_category: boolean }
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { active: 'active', inactive: 'neutral', discontinued: 'closed' }

export function ProductComponents({ productId, parentCategory = null }: { productId: string; parentCategory?: string | null }) {
  const [components, setComponents] = useState<Component[] | null>(null)
  const [editing, setEditing] = useState<Component | 'new' | null>(null)
  const [detailFor, setDetailFor] = useState<Component | null>(null)
  const [detailTab, setDetailTab] = useState('general')
  const openDetail = (cmp: Component, tab: string) => { setDetailTab(tab); setDetailFor(cmp) }

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
            <li key={cmp.id}
              role="button" tabIndex={0}
              onClick={() => openDetail(cmp, 'general')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(cmp, 'general') } }}
              aria-label={`Open ${cmp.name}`}
              className={cn('flex cursor-pointer items-center gap-3 rounded-card border border-hairline bg-surface p-3 shadow-e1 transition-colors hover:bg-sunken/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/15', cmp.status === 'discontinued' && 'opacity-60')}>
              <ComponentThumb url={cmp.image_url} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{cmp.name}</p>
                <p className="truncate text-xs text-muted">{[`×${cmp.quantity}`, cmp.sku, (cmp.use_parent_category ? parentCategory : cmp.category) || null, cmp.price_cents != null ? formatCents(cmp.price_cents, cmp.currency) : null].filter(Boolean).join(' · ')}</p>
              </div>
              <Badge variant={STATUS_VARIANT[cmp.status] ?? 'neutral'}>{cmp.status}</Badge>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openDetail(cmp, 'qr') }}
                aria-label={`QR code for ${cmp.name}`}
                title="View the scannable QR code for this sub-product"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-2.5 text-xs font-medium text-ink shadow-e1 transition-colors hover:bg-sunken">
                <QrCode className="h-4 w-4" /> QR
              </button>
              <span onClick={(e) => e.stopPropagation()}>
                <Menu ariaLabel="Component quick actions" buttonClassName="flex h-9 w-9 items-center justify-center rounded-lg text-subtle hover:bg-white hover:text-ink" items={([
                  { label: 'View QR', icon: QrCode, onClick: () => openDetail(cmp, 'qr') },
                  { label: 'Manage images', icon: ImageIcon, onClick: () => openDetail(cmp, 'images') },
                  { label: 'Manage variants', icon: Layers, onClick: () => openDetail(cmp, 'variants') },
                  { label: 'Edit attributes', icon: SlidersHorizontal, onClick: () => openDetail(cmp, 'attributes') },
                  { label: 'Edit component', icon: Pencil, onClick: () => openDetail(cmp, 'general') },
                  cmp.status === 'discontinued'
                    ? { label: 'Restore', icon: RotateCcw, onClick: () => setStatus(cmp, 'active') }
                    : { label: 'Archive', icon: Archive, onClick: () => setStatus(cmp, 'discontinued') },
                ]) as MenuItem[]} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing && <ComponentForm productId={productId} component={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {detailFor && (() => { const live = components?.find((c) => c.id === detailFor.id) ?? detailFor; return (
        <ComponentDetail component={live} initialTab={detailTab} onClose={() => setDetailFor(null)} onChanged={load} />
      ) })()}
    </div>
  )
}

function ComponentThumb({ url }: { url: string | null }) {
  return url
    ? // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
    : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sunken text-muted"><ImageIcon className="h-5 w-5" /></span>
}

function ComponentForm({ productId, component, onClose, onSaved }: { productId: string; component: Component | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(component?.name ?? '')
  const [sku, setSku] = useState(component?.sku ?? '')
  const [componentType, setComponentType] = useState(component?.component_type ?? '')
  const [quantity, setQuantity] = useState(String(component?.quantity ?? 1))
  const [price, setPrice] = useState(centsToInput(component?.price_cents))
  const [cost, setCost] = useState(centsToInput(component?.cost_cents))
  const [description, setDescription] = useState(component?.description ?? '')
  const [trackInventory, setTrackInventory] = useState(component?.track_inventory ?? true)
  const [notes, setNotes] = useState(component?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) { toast.error('Name is required.'); return }
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) { toast.error('Quantity must be greater than 0.'); return }
    const cents = inputToCents(price)
    if (Number.isNaN(cents)) { toast.error('Enter a valid price.'); return }
    const costCents = inputToCents(cost)
    if (Number.isNaN(costCents)) { toast.error('Enter a valid cost.'); return }
    setSaving(true)
    const body = { name: name.trim(), sku: sku.trim() || null, componentType: componentType.trim() || null, quantity: qty, priceCents: cents, costCents, description: description.trim() || null, trackInventory, notes: notes.trim() || null }
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
        <div className="space-y-1.5"><Label>Name <span className="text-danger">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Left Arm Sofa, Corner Piece" maxLength={300} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optional" maxLength={200} /></div>
          <div className="space-y-1.5"><Label>Component type</Label><Input value={componentType} onChange={(e) => setComponentType(e.target.value)} placeholder="Optional" maxLength={120} /></div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5"><Label>Qty per product</Label><Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="1" step="1" inputMode="numeric" /></div>
          <div className="space-y-1.5"><Label>Price (USD)</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" /></div>
          <div className="space-y-1.5"><Label>Cost (USD)</Label><Input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" /></div>
        </div>
        <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" maxLength={5000} /></div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" /> Track inventory for this component</label>
        <div className="space-y-1.5"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" maxLength={2000} /></div>
        <p className="text-xs text-muted">Fabric, color and dimensions live on the component’s <strong>Attributes</strong> (from your installed package). Manage variants &amp; images from the component’s <strong>Variants &amp; images</strong> action.</p>
        {component && (
          <a href={`/p/${component.qr_code_token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent-strong hover:underline"><ExternalLink className="h-4 w-4" /> View public QR page</a>
        )}
      </div>
    </Drawer>
  )
}
