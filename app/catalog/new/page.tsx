'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ProductForm } from '@/components/catalog/product-form'

export default function NewProductPage() {
  const router = useRouter()
  async function create(payload: Record<string, unknown>) {
    const res = await fetch('/api/catalog/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error || 'Failed to save')
    // Straight to the product, in edit mode with the cost card open. Cost is deliberately NOT part
    // of this request: a product row and a cost row are two writes to two tables, and across two HTTP
    // calls they cannot be made atomic. Promising cost here would mean a product could be saved while
    // the cost the owner typed was silently lost — worse than asking for it on the next screen.
    router.push(`/catalog/${d.product.id}?created=1`)
  }
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <Link href="/catalog" className="text-sm text-subtle hover:text-ink">← Catalog</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold text-ink">Add product</h1>
      <ProductForm onSubmit={create} submitLabel="Create product" />
    </div>
  )
}
