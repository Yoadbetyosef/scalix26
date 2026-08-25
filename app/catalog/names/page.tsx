import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { ProductNamesManager } from '@/components/catalog/product-names-manager'

// The business's own product-name list, managed by the business. Gated exactly like the rest of the
// catalog — a tenant without the module gets a 404 rather than an empty page hinting the feature exists.
export const dynamic = 'force-dynamic'

export default async function ProductNamesPage() {
  const s = await requireCatalogTenant()
  if (!s) notFound()

  return (
    <div className="v2 v2-embedded mx-auto max-w-3xl p-4 sm:p-6">
      <div className="v2-head">
        <Link href="/catalog" className="v2-act tap-target"><ChevronLeft className="w-3.5 h-3.5" /> Catalogue</Link>
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Product name list</p>
        <s />
      </div>
      <ProductNamesManager />
    </div>
  )
}
