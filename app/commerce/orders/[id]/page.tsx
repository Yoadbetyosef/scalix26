import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { getOrder, lineCoverage } from '@/lib/commerce/orders'
import { listSuppliers } from '@/lib/commerce/suppliers'
import { OrderPoButton } from '@/components/commerce/order-po-button'

export const dynamic = 'force-dynamic'
const money = (c: number, cur = 'usd') => `${cur === 'usd' ? '$' : ''}${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const d = await getOrder((await params).id)
  if (!d) notFound()
  const o = d.order as Record<string, unknown>
  const items = d.items as Record<string, unknown>[]
  const totalMissing = items.reduce((s, i) => s + lineCoverage(i as never).missing, 0)
  const suppliers = totalMissing > 0 ? await listSuppliers() : []

  return (
    <div className="mx-auto max-w-4xl px-6 pb-16">
      <div className="mb-4"><Link href="/commerce/orders" className="text-sm text-gray-500 hover:underline">← Customer Orders</Link></div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-gray-500">{o.order_number as string}</div>
          <h1 className="text-2xl font-semibold text-gray-900">{(o.customer_name as string) || 'Customer Order'}</h1>
          <div className="mt-1 flex gap-2">
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">{(o.status as string).replace(/_/g, ' ')}</span>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">{(o.payment_status as string).replace(/_/g, ' ')}</span>
          </div>
        </div>
        <div className="text-right"><div className="text-xs text-gray-500">Total</div><div className="text-xl font-semibold text-gray-900">{money(Number(o.total_cents), o.currency as string)}</div></div>
      </div>

      {totalMissing > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {totalMissing} unit{totalMissing === 1 ? '' : 's'} not yet allocated — these need purchasing.
          <OrderPoButton orderId={o.id as string} suppliers={suppliers.map((s) => ({ id: s.id as string, company_name: s.company_name as string }))} />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-500"><tr>{['Item', 'Ordered', 'Allocated', 'Missing', 'Received', 'Delivered', 'Unit'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((i) => {
              const cov = lineCoverage(i as never)
              return (
                <tr key={i.id as string}>
                  <td className="px-3 py-2"><div className="font-medium text-gray-900">{(i.description_snapshot as string) || 'Item'}</div>{i.sku_snapshot ? <div className="text-xs text-gray-400">{i.sku_snapshot as string}</div> : null}</td>
                  <td className="px-3 py-2 tabular-nums">{cov.ordered}</td>
                  <td className="px-3 py-2 tabular-nums text-emerald-700">{cov.allocated}</td>
                  <td className={`px-3 py-2 tabular-nums ${cov.missing > 0 ? 'text-red-600' : 'text-gray-400'}`}>{cov.missing}</td>
                  <td className="px-3 py-2 tabular-nums">{cov.received}</td>
                  <td className="px-3 py-2 tabular-nums">{cov.delivered}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{money(Number(i.unit_price_cents))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[11px] text-gray-400">Fulfillment status is separate from payment status. Allocated quantities came from reservations transferred at conversion.</p>
    </div>
  )
}
