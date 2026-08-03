import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { ProductNamesManager } from '@/components/catalog/product-names-manager'

// The business's own product-name list, managed by the business. Gated exactly like the rest of the
// catalog — a tenant without the module gets a 404 rather than an empty page hinting the feature exists.
export const dynamic = 'force-dynamic'

export default async function ProductNamesPage() {
  const s = await requireCatalogTenant()
  if (!s) notFound()

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4"><Link href="/catalog" className="text-sm text-gray-500 hover:underline">← Catalog</Link></div>
      <h1 className="text-2xl font-semibold text-gray-900">Product name list</h1>
      <p className="mt-1 text-sm text-gray-500">The names suggested when you add a product.</p>
      <div className="mt-6"><ProductNamesManager /></div>
    </div>
  )
}
