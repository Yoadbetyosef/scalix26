import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { listSuppliers } from '@/lib/commerce/suppliers'
import { listProducts } from '@/lib/commerce/catalog'
import { NewPoForm } from '@/components/commerce/new-po-form'

export const dynamic = 'force-dynamic'

export default async function NewPurchaseOrderPage() {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const [suppliers, products] = await Promise.all([listSuppliers(), listProducts()])
  return (
    <div className="mx-auto max-w-3xl px-6 pb-16">
      <div className="mb-4"><Link href="/commerce/purchase-orders" className="text-sm text-gray-500 hover:underline">← Purchase Orders</Link></div>
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">New Purchase Order</h1>
      <p className="mb-5 text-sm text-gray-500">Order stock from a supplier. Pick catalog items or add custom lines.</p>
      <NewPoForm
        suppliers={suppliers.map((s) => ({ id: s.id as string, company_name: s.company_name as string }))}
        products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku }))}
      />
    </div>
  )
}
