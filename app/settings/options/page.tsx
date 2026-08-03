import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { OrderOptionsManager } from '@/components/settings/order-options-manager'

// Tenant-managed dropdown lists for the Orders module. Gated exactly like the rest of Orders — a tenant
// without the module gets a 404 rather than an empty page that hints the feature exists.
export const dynamic = 'force-dynamic'

export default async function OrderOptionsPage() {
  const a = await requireOrdersAccess()
  if (!a) notFound()

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4"><Link href="/settings" className="text-sm text-gray-500 hover:underline">← Settings</Link></div>
      <h1 className="text-2xl font-semibold text-gray-900">Order dropdowns</h1>
      <p className="mt-1 text-sm text-gray-500">Stone quality, shapes, metals — the choices you pick from when writing an order.</p>
      <div className="mt-6"><OrderOptionsManager /></div>
    </div>
  )
}
