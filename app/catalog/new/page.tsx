'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
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
    <div className="v2 v2-embedded mx-auto max-w-2xl p-4 sm:p-6">
      {/* The way back is a pill like every other verb, not a bare arrow-and-word. The heading goes:
          this is the only screen at this URL, and "Add product" is already on the button that saves. */}
      <div className="v2-head">
        <Link href="/catalog" className="v2-act tap-target"><ChevronLeft className="w-3.5 h-3.5" /> Catalogue</Link>
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />New product</p>
        <s />
      </div>
      <ProductForm onSubmit={create} submitLabel="Create product" />
    </div>
  )
}
