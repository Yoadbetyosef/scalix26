import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { listLocations } from '@/lib/commerce/inventory'
import { listProducts } from '@/lib/commerce/catalog'
import { InventoryPanel } from '@/components/commerce/inventory-panel'

export const dynamic = 'force-dynamic'

export default async function CommerceInventoryPage() {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const [locations, products] = await Promise.all([listLocations(), listProducts({ includeDrafts: false })])
  return (
    <div className="mx-auto max-w-5xl px-6 pb-10">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Inventory</h1>
      <p className="mb-5 text-sm text-gray-500">Locations, opening stock, and the immutable movement ledger. Reservations move stock from Available into Reserved without reducing On-hand.</p>
      <InventoryPanel locations={locations} products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku }))} />
    </div>
  )
}
