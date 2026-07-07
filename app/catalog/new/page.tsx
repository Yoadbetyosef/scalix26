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
    router.push(`/catalog/${d.product.id}`)
  }
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <Link href="/catalog" className="text-sm text-subtle hover:text-ink">← Catalog</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold text-ink">Add product</h1>
      <ProductForm onSubmit={create} submitLabel="Create product" />
    </div>
  )
}
