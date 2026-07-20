'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Info, Layers, Boxes, SlidersHorizontal, Image as ImageIcon, Warehouse, Activity, Package, Pencil, Archive, Trash2, RotateCcw, Palette } from 'lucide-react'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Menu } from '@/components/ui/menu'
import { ProductGeneralForm } from '@/components/commerce/product-general-form'
import { ProductVariants } from '@/components/commerce/product-variants'
import { ProductComponents } from '@/components/commerce/product-components'
import { AttributeEditor } from '@/components/commerce/attribute-editor'
import { ProductInventory } from '@/components/commerce/product-inventory'
import { ProductActivity } from '@/components/commerce/product-activity'
import { ProductMedia } from '@/components/commerce/product-media'
import { ProductMaterials } from '@/components/commerce/product-materials'
import { useTerminology } from '@/lib/hooks/use-terminology'
import { toast } from 'sonner'

interface Product { id: string; name: string; sku: string | null; status: string; image_url: string | null; [k: string]: unknown }
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { active: 'active', inactive: 'neutral', discontinued: 'closed' }

export function ProductDetail({ productId }: { productId: string }) {
  const router = useRouter()
  const { term } = useTerminology()
  const [product, setProduct] = useState<Product | null | 'notfound'>(null)
  const [tab, setTab] = useState('general')
  const [deleting, setDeleting] = useState(false)
  // Labels resolve through tenant terminology (furniture: Variants→"Configurations", Materials→"Fabrics").
  const TABS: TabItem[] = [
    { key: 'general', label: 'General', icon: Info },
    { key: 'variants', label: term('variant', { plural: true, fallback: 'Variants' }), icon: Layers },
    { key: 'components', label: term('component', { plural: true, fallback: 'Components' }), icon: Boxes },
    { key: 'fabrics', label: term('material', { plural: true, fallback: 'Materials' }), icon: Palette },
    { key: 'attributes', label: 'Attributes', icon: SlidersHorizontal },
    { key: 'media', label: 'Media', icon: ImageIcon },
    { key: 'inventory', label: 'Inventory', icon: Warehouse },
    { key: 'activity', label: 'Activity', icon: Activity },
  ]

  const reloadProduct = () => fetch(`/api/core/products/${productId}`).then((r) => r.json()).then((d) => setProduct(d.product)).catch(() => {})
  async function archive(archived: boolean) {
    const res = await fetch(`/api/core/products/${productId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived }) })
    if (res.ok) { toast.success(archived ? 'Product archived — hidden from the catalog, kept in history.' : 'Product restored.'); reloadProduct() } else toast.error('Could not update the product.')
  }

  useEffect(() => {
    let live = true
    fetch(`/api/core/products/${productId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) setProduct(d.product) })
      .catch((e) => { if (live) setProduct(e.message === '404' ? 'notfound' : null) })
    return () => { live = false }
  }, [productId])

  async function saveGeneral(payload: Record<string, unknown>) {
    const res = await fetch(`/api/core/products/${productId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) { setProduct(d.product); toast.success('Product saved.'); return { ok: true } }
    return { ok: false, error: d.error }
  }

  async function setPrimary(url: string) {
    const res = await fetch(`/api/core/products/${productId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image_url: url }) })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) { setProduct(d.product); toast.success('Primary image set.') } else toast.error('Could not set the primary image.')
  }

  if (product === 'notfound') return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <EmptyState icon={Package} title="Product not found" action={<Link href="/commerce/catalog" className="text-sm text-accent-strong hover:underline">← Back to catalog</Link>}>
        This product doesn’t exist or isn’t part of your business.
      </EmptyState>
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <Link href="/commerce/catalog" className="mb-4 inline-flex items-center gap-1.5 text-sm text-subtle hover:text-ink"><ArrowLeft className="h-4 w-4" /> Catalog</Link>

      {product === null ? (
        <Skeleton className="mb-6 h-14 w-full" />
      ) : (
        <header className="mb-5 flex items-center gap-3">
          {product.image_url
            ? // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image_url} alt="" className="h-12 w-12 rounded-lg object-cover" />
            : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-sunken text-muted"><Package className="h-6 w-6" /></span>}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-light tracking-tight text-ink">{product.name}</h1>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              {product.sku && <span className="truncate">{product.sku}</span>}
              <Badge variant={STATUS_VARIANT[product.status] ?? 'neutral'}>{product.status}</Badge>
              {!!product.archived_at && <Badge variant="closed">Archived</Badge>}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setTab('general')}><Pencil className="h-4 w-4" /> Edit product</Button>
            <Menu label="More actions" ariaLabel="More product actions" items={[
              product.archived_at
                ? { label: 'Restore product', icon: RotateCcw, onClick: () => archive(false) }
                : { label: 'Archive product', icon: Archive, onClick: () => archive(true) },
              { label: 'Delete product', icon: Trash2, destructive: true, onClick: () => setDeleting(true) },
            ]} />
          </div>
        </header>
      )}

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-6" />

      {tab === 'general' && (
        product === null ? <div className="max-w-2xl space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
          : <ProductGeneralForm initial={product} submitLabel="Save changes" onSubmit={saveGeneral} />
      )}
      {tab === 'variants' && <ProductVariants productId={productId} />}
      {tab === 'components' && <ProductComponents productId={productId} parentCategory={product && typeof product.category === 'string' ? product.category : null} />}
      {tab === 'fabrics' && <ProductMaterials productId={productId} />}
      {tab === 'attributes' && (
        <div className="max-w-2xl">
          <p className="mb-4 text-sm text-muted">Industry-specific details for this product, from your installed package and custom fields.</p>
          <AttributeEditor endpoint={`/api/core/products/${productId}/attributes`} />
        </div>
      )}
      {tab === 'inventory' && <ProductInventory productId={productId} />}
      {tab === 'activity' && <ProductActivity productId={productId} />}
      {tab === 'media' && (product
        ? <ProductMedia productId={productId} primaryUrl={typeof product.image_url === 'string' ? product.image_url : null} onSetPrimary={setPrimary} />
        : <Skeleton className="h-40 w-full" />)}

      {deleting && product && <DeleteProductModal productId={productId} productName={product.name} onClose={() => setDeleting(false)} onDeleted={() => router.push('/commerce/catalog')} />}
    </div>
  )
}

function DeleteProductModal({ productId, productName, onClose, onDeleted }: { productId: string; productName: string; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const confirmed = typed.trim() === productName.trim()
  async function del() {
    if (!confirmed) return
    setBusy(true)
    const res = await fetch(`/api/core/products/${productId}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok && d.ok) { toast.success(d.mode === 'soft' ? 'Product deleted — kept in historical documents.' : 'Product deleted.'); onDeleted() }
    else toast.error(d.error || 'Could not delete the product.')
  }
  return (
    <Drawer open onClose={onClose} title="Delete product"
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button variant="destructive" size="sm" loading={busy} disabled={!confirmed} onClick={del}>Delete product</Button></div>}>
      <div className="space-y-4 text-sm">
        <p className="text-subtle">Deleting <strong className="text-ink">{productName}</strong> removes it and its <strong>components, variants, images, QR pages and inventory records</strong> from the active catalog and all new-selection dropdowns.</p>
        <p className="rounded-card border border-info/20 bg-info/5 px-3 py-2 text-xs text-subtle">If this product (or any of its components) appears on any estimate, quote, order or invoice, it is <strong>kept as a tombstone</strong> so those historical documents, payments and activity stay intact and readable — nothing is broken.</p>
        <div className="space-y-1.5">
          <Label>Type the product name to confirm</Label>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={productName} autoFocus />
        </div>
      </div>
    </Drawer>
  )
}
