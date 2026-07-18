'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Info, Layers, Boxes, SlidersHorizontal, Image as ImageIcon, Warehouse, Activity, Package, Wrench } from 'lucide-react'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ProductGeneralForm } from '@/components/commerce/product-general-form'
import { toast } from 'sonner'

interface Product { id: string; name: string; sku: string | null; status: string; image_url: string | null; [k: string]: unknown }
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { active: 'active', inactive: 'neutral', discontinued: 'closed' }

const TABS: TabItem[] = [
  { key: 'general', label: 'General', icon: Info },
  { key: 'variants', label: 'Variants', icon: Layers },
  { key: 'components', label: 'Components', icon: Boxes },
  { key: 'attributes', label: 'Attributes', icon: SlidersHorizontal },
  { key: 'media', label: 'Media', icon: ImageIcon },
  { key: 'inventory', label: 'Inventory', icon: Warehouse },
  { key: 'activity', label: 'Activity', icon: Activity },
]

export function ProductDetail({ productId }: { productId: string }) {
  const [product, setProduct] = useState<Product | null | 'notfound'>(null)
  const [tab, setTab] = useState('general')

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
            </div>
          </div>
        </header>
      )}

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-6" />

      {tab === 'general' && (
        product === null ? <div className="max-w-2xl space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
          : <ProductGeneralForm initial={product} submitLabel="Save changes" onSubmit={saveGeneral} />
      )}
      {tab !== 'general' && <ComingSoon name={TABS.find((t) => t.key === tab)?.label ?? ''} />}
    </div>
  )
}

function ComingSoon({ name }: { name: string }) {
  return <EmptyState icon={Wrench} title={`${name} — coming soon`}>This tab is part of the Core UI build and lands in an upcoming step.</EmptyState>
}
