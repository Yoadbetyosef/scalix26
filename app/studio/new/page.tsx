'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { ProductForm } from '@/components/studio/product-form'

export default function NewStudioProductPage() {
  const router = useRouter()
  async function create(payload: Record<string, unknown>) {
    const res = await fetch('/api/studio/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error || 'Failed to save')
    router.push(`/studio/${d.product.id}`)
  }
  return (
    <div className="v2 v2-embedded mx-auto max-w-2xl p-4 sm:p-6">
      <div className="v2-head">
        <Link href="/studio" className="v2-act tap-target"><ChevronLeft className="w-3.5 h-3.5" /> Studio</Link>
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><i />New product</p>
        <s />
      </div>
      <ProductForm onSubmit={create} submitLabel="Create product" />
    </div>
  )
}
