import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { listOrders } from '@/lib/commerce/orders'

export const dynamic = 'force-dynamic'
const money = (c: number, cur = 'usd') => `${cur === 'usd' ? '$' : ''}${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const STATUS: Record<string, string> = { allocated: 'bg-emerald-100 text-emerald-700', partially_allocated: 'bg-amber-100 text-amber-700', purchasing_required: 'bg-red-100 text-red-700', confirmed: 'bg-blue-100 text-blue-700', completed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-gray-100 text-gray-500' }

export default async function OrdersPage() {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const orders = await listOrders()
  return (
    <div className="mx-auto max-w-5xl px-6 pb-10">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Customer Orders</h1>
      <p className="mb-5 text-sm text-gray-500">{orders.length} order{orders.length === 1 ? '' : 's'} · created by converting a Draft.</p>
      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">No customer orders yet. Convert a Draft to create one.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {orders.map((o) => (
            <Link key={o.id as string} href={`/commerce/orders/${o.id}`} className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50">
              <span className="font-mono text-xs text-gray-500">{o.order_number as string}</span>
              <span className="text-gray-900">{(o.customer_name as string) || 'Customer'}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS[o.status as string] ?? 'bg-gray-100 text-gray-600'}`}>{(o.status as string).replace(/_/g, ' ')}</span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{(o.payment_status as string).replace(/_/g, ' ')}</span>
              <span className="ml-auto tabular-nums text-gray-900">{money(Number(o.total_cents), o.currency as string)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
