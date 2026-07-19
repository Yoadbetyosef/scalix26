'use client'

import { useState } from 'react'
import { Info, Image as ImageIcon, SlidersHorizontal, Layers, Warehouse, QrCode } from 'lucide-react'
import { Drawer } from '@/components/ui/drawer'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { AttributeEditor } from '@/components/commerce/attribute-editor'
import { ComponentImages, ComponentQR } from '@/components/commerce/component-images'
import { ComponentVariants } from '@/components/commerce/component-catalog'
import { InventoryPanel } from '@/components/commerce/product-inventory'
import { centsToInput, inputToCents } from '@/lib/core/money-format'
import { toast } from 'sonner'

export interface ComponentLite {
  id: string; name: string; sku: string | null; quantity: number; price_cents: number | null; cost_cents: number | null
  status: string; notes: string | null; description: string | null; component_type: string | null; track_inventory: boolean; image_url: string | null; qr_code_token: string
}

const TABS: TabItem[] = [
  { key: 'general', label: 'General', icon: Info },
  { key: 'images', label: 'Images', icon: ImageIcon },
  { key: 'attributes', label: 'Attributes', icon: SlidersHorizontal },
  { key: 'variants', label: 'Variants', icon: Layers },
  { key: 'inventory', label: 'Inventory', icon: Warehouse },
  { key: 'qr', label: 'QR', icon: QrCode },
]

// The component opened as its own catalog item — everything about one component in one tabbed editor.
export function ComponentDetail({ component, initialTab = 'general', onClose, onChanged }: { component: ComponentLite; initialTab?: string; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <Drawer open onClose={onClose} title={component.name}>
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'general' && <ComponentGeneral component={component} onChanged={onChanged} />}
      {tab === 'images' && <ComponentImages componentId={component.id} primaryUrl={component.image_url} onChanged={onChanged} />}
      {tab === 'attributes' && <AttributeEditor endpoint={`/api/core/components/${component.id}/attributes`} emptyHint="No component attributes defined yet. Add component fields in Settings → Custom fields." />}
      {tab === 'variants' && <ComponentVariants componentId={component.id} />}
      {tab === 'inventory' && <InventoryPanel itemKind="component" itemId={component.id} />}
      {tab === 'qr' && <ComponentQR componentId={component.id} />}
    </Drawer>
  )
}

function ComponentGeneral({ component, onChanged }: { component: ComponentLite; onChanged: () => void }) {
  const [name, setName] = useState(component.name)
  const [sku, setSku] = useState(component.sku ?? '')
  const [componentType, setComponentType] = useState(component.component_type ?? '')
  const [quantity, setQuantity] = useState(String(component.quantity ?? 1))
  const [price, setPrice] = useState(centsToInput(component.price_cents))
  const [cost, setCost] = useState(centsToInput(component.cost_cents))
  const [description, setDescription] = useState(component.description ?? '')
  const [trackInventory, setTrackInventory] = useState(component.track_inventory ?? true)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) { toast.error('Name is required.'); return }
    const qty = Number(quantity); if (!Number.isFinite(qty) || qty <= 0) { toast.error('Quantity must be greater than 0.'); return }
    const p = inputToCents(price), c = inputToCents(cost)
    if (Number.isNaN(p) || Number.isNaN(c)) { toast.error('Enter valid amounts.'); return }
    setSaving(true)
    const res = await fetch(`/api/core/components/${component.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), sku: sku.trim() || null, componentType: componentType.trim() || null, quantity: qty, priceCents: p, costCents: c, description: description.trim() || null, trackInventory }) })
    setSaving(false)
    if (res.ok) { toast.success('Component saved.'); onChanged() } else toast.error('Could not save the component.')
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5"><Label>Name <span className="text-danger">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={300} /></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5"><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={200} /></div>
        <div className="space-y-1.5"><Label>Component type</Label><Input value={componentType} onChange={(e) => setComponentType(e.target.value)} maxLength={120} /></div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5"><Label>Qty / product</Label><Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="1" step="1" inputMode="numeric" /></div>
        <div className="space-y-1.5"><Label>Price (USD)</Label><Input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" /></div>
        <div className="space-y-1.5"><Label>Cost (USD)</Label><Input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" /></div>
      </div>
      <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} /></div>
      <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" /> Track inventory for this component</label>
      <div className="flex justify-end"><Button size="sm" loading={saving} onClick={save}>Save</Button></div>
    </div>
  )
}
