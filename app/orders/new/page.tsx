import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { OrderForm } from '@/components/orders/order-form'

export const dynamic = 'force-dynamic'

export default async function NewOrderPage() {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-5"><Link href="/orders" className="text-sm text-gray-500 hover:underline">← Orders</Link><h1 className="mt-1 text-2xl font-semibold text-gray-900">New Order</h1></div>
      <OrderForm />
    </div>
  )
}
