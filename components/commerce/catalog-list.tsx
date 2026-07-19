'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Package, Plus, Search, Layers, Boxes } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionNav } from '@/components/commerce/section-nav'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface ProductRow {
  id: string; name: string; sku: string | null; category: string | null
  price: number | null; status: string; image_url: string | null
  variantCount: number; componentCount: number
}

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = { active: 'active', inactive: 'neutral', discontinued: 'closed' }
const money = (n: number | null) => (n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n))

export function CatalogList() {
  const [products, setProducts] = useState<ProductRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [categories, setCategories] = useState<string[]>([])

  useEffect(() => {
    let live = true
    fetch('/api/core/products')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Commerce is not enabled for this business.' : 'Failed to load products.'))))
      .then((d) => { if (live) setProducts(d.products ?? []) })
      .catch((e) => { if (live) { setError(e.message); toast.error(e.message) } })
    fetch('/api/core/categories').then((r) => r.json()).then((d) => { if (live) setCategories((d.categories ?? []).map((c: { name: string }) => c.name)) }).catch(() => {})
    return () => { live = false }
  }, [])

  const filtered = useMemo(() => {
    if (!products) return []
    const s = q.trim().toLowerCase()
    return products.filter((p) => (!cat || p.category === cat) && (!s || [p.name, p.sku, p.category].some((v) => v?.toLowerCase().includes(s))))
  }, [products, q, cat])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <SectionNav />
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-light tracking-tight text-ink">Catalog</h1>
          <p className="mt-1 text-sm text-muted">Products, variants and components for your business.</p>
        </div>
        <Link href="/commerce/catalog/new" className={cn(buttonVariants(), 'shrink-0')}>
          <Plus className="h-4 w-4" /> New product
        </Link>
      </header>

      {products && products.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="h-11 w-full rounded-input border border-hairline bg-white pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-ink/30 focus:outline-none" />
          </div>
          {categories.length > 0 && (
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-11 rounded-input border border-hairline bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      )}

      {error ? (
        <EmptyState icon={Package} title="Couldn’t load the catalog">{error}</EmptyState>
      ) : !products ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : products.length === 0 ? (
        <EmptyState icon={Package} title="No products yet" action={<Link href="/commerce/catalog/new" className={buttonVariants()}><Plus className="h-4 w-4" /> Add your first product</Link>}>
          Add a product to start building your catalog. You can add variants, components and vertical attributes on each one.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">No products match “{q}”.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-card border border-hairline bg-surface shadow-e1 md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Variants</th>
                  <th className="px-4 py-3 font-medium">Components</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-hairline last:border-0 transition-colors hover:bg-sunken/60">
                    <td className="px-4 py-3">
                      <Link href={`/commerce/catalog/${p.id}`} className="flex items-center gap-3">
                        <ProductThumb url={p.image_url} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{p.name}</span>
                          {p.sku && <span className="block truncate text-xs text-muted">{p.sku}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-subtle">{p.category || '—'}</td>
                    <td className="px-4 py-3 text-ink">{money(p.price)}</td>
                    <td className="px-4 py-3 text-subtle">{p.variantCount || '—'}</td>
                    <td className="px-4 py-3 text-subtle">{p.componentCount || '—'}</td>
                    <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[p.status] ?? 'neutral'}>{p.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {filtered.map((p) => (
              <li key={p.id}>
                <Link href={`/commerce/catalog/${p.id}`} className="flex items-center gap-3 rounded-card border border-hairline bg-surface p-3 shadow-e1 active:scale-[0.99]">
                  <ProductThumb url={p.image_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{p.name}</p>
                    <p className="truncate text-xs text-muted">{[p.category, p.sku].filter(Boolean).join(' · ') || '—'}</p>
                    <p className="mt-1 flex items-center gap-3 text-xs text-subtle">
                      <span className="text-ink">{money(p.price)}</span>
                      {p.variantCount > 0 && <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" />{p.variantCount}</span>}
                      {p.componentCount > 0 && <span className="inline-flex items-center gap-1"><Boxes className="h-3 w-3" />{p.componentCount}</span>}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[p.status] ?? 'neutral'}>{p.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function ProductThumb({ url }: { url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
  ) : (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sunken text-muted"><Package className="h-5 w-5" /></span>
  )
}
