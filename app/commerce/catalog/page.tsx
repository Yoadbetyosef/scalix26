import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { listProducts } from '@/lib/commerce/catalog'
import { ProductForm } from '@/components/commerce/product-form'

export const dynamic = 'force-dynamic'
const money = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
const TYPE_LABEL: Record<string, string> = { simple_product: 'Product', configurable_product: 'Collection', component: 'Component', bundle: 'Bundle', service: 'Service', custom_item: 'Custom' }
const STATUS_STYLE: Record<string, string> = { draft: 'bg-amber-100 text-amber-700', active: 'bg-emerald-100 text-emerald-700', discontinued: 'bg-gray-100 text-gray-600', archived: 'bg-gray-100 text-gray-500' }

export default async function CatalogPage() {
  const c = await requireCommerceAccess()
  if (!c) notFound()
  // Catalog managers see drafts too (owner has catalog.manage in V1).
  const products = await listProducts({ includeDrafts: true })

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Catalog</h1>
          <p className="text-sm text-gray-500">{products.length} product{products.length === 1 ? '' : 's'}</p>
        </div>
        <ProductForm />
      </div>

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">No products yet. Add your first catalog product.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-gray-900">{p.name}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{TYPE_LABEL[p.productType] ?? p.productType}{p.sku ? ` · ${p.sku}` : ''}</div>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[p.status] ?? 'bg-gray-100 text-gray-600'}`}>{p.status}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-gray-500">{p.category ?? '—'}</span>
                <span className="font-medium text-gray-900">{money(p.defaultPrice)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-6 text-[11px] text-gray-400">Availability (on hand / reserved / incoming) appears here once inventory is set up. Reservations, variants, and bundle availability arrive in the next phase.</p>
    </div>
  )
}
