import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { listOrders } from '@/lib/orders/store'
import { STAGE_LABELS } from '@/lib/orders/stages'

export const dynamic = 'force-dynamic'
const money = (c: number, cur = 'usd') => `${cur === 'usd' ? '$' : ''}${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export default async function OrdersPage() {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const orders = await listOrders()

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Orders</h1>
          <p className="text-sm text-gray-500">{orders.length} order{orders.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/orders/board" className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Board</Link>
          <Link href="/orders/new" className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">+ New Order</Link>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">No orders yet. Create your first order.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500"><tr>{['Order', 'Customer', 'Stage', 'Factory', 'Total', 'Requested', ''].map((h) => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-900">{o.orderNumber}</td>
                  <td className="px-4 py-2.5 text-gray-800">{o.customerName ?? '—'}</td>
                  <td className="px-4 py-2.5"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{STAGE_LABELS[o.stage]}</span></td>
                  <td className="px-4 py-2.5 text-gray-600">{o.factoryName ?? '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-gray-800">{money(o.subtotalCents, o.currency)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{o.requestedCompletionDate ?? '—'}</td>
                  <td className="px-4 py-2.5"><Link href={`/orders/${o.id}`} className="text-sm font-medium text-blue-600 hover:underline">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
