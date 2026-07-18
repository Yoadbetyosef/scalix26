'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { ProductGeneralForm } from '@/components/commerce/product-general-form'
import { toast } from 'sonner'

export function ProductCreate() {
  const router = useRouter()

  async function create(payload: Record<string, unknown>) {
    const res = await fetch('/api/core/products', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d.ok) { toast.success('Product created.'); router.push(`/commerce/catalog/${d.product.id}`); return { ok: true } }
    return { ok: false, error: d.error }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <Link href="/commerce/catalog" className="mb-4 inline-flex items-center gap-1.5 text-sm text-subtle hover:text-ink"><ArrowLeft className="h-4 w-4" /> Catalog</Link>
      <h1 className="mb-6 text-2xl font-light tracking-tight text-ink">New product</h1>
      <ProductGeneralForm submitLabel="Create product" onSubmit={create} />
    </div>
  )
}
