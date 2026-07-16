import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { getPO } from '@/lib/commerce/purchase-orders'
import { listLocations } from '@/lib/commerce/inventory'
import { PoActions } from '@/components/commerce/po-actions'

export const dynamic = 'force-dynamic'
const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

export default async function PoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const d = await getPO((await params).id)
  if (!d) notFound()
  const po = d.po as Record<string, unknown>
  const items = d.items as Record<string, unknown>[]
  const locations = await listLocations()

  return (
    <div className="mx-auto max-w-4xl px-6 pb-16">
      <div className="mb-4"><Link href="/commerce/purchase-orders" className="text-sm text-gray-500 hover:underline">← Purchase Orders</Link></div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-gray-500">{po.po_number as string}</div>
          <h1 className="text-2xl font-semibold text-gray-900">Purchase Order</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">{(po.status as string).replace(/_/g, ' ')}</span>
            {po.approval_required !== 'none' ? <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs text-amber-700">{po.approval_required as string} approval</span> : null}
            {po.email_status !== 'not_sent' ? <span className={`rounded-full px-2.5 py-0.5 text-xs ${po.email_status === 'sent' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>email {po.email_status as string}</span> : null}
          </div>
        </div>
        <div className="text-right"><div className="text-xs text-gray-500">Total</div><div className="text-xl font-semibold text-gray-900">{money(Number(po.total_cost_cents))}</div></div>
      </div>

      <div className="mb-4"><PoActions poId={po.id as string} status={po.status as string} approvalRequired={po.approval_required as string} emailStatus={po.email_status as string} locations={locations.map((l) => ({ id: l.id, name: l.name }))} items={items.map((i) => ({ id: i.id as string, description_snapshot: (i.description_snapshot as string) ?? null, quantity: Number(i.quantity), received_quantity: Number(i.received_quantity) }))} /></div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-500"><tr>{['Item', 'Ordered', 'Received', 'Unit cost'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((i) => (
              <tr key={i.id as string}>
                <td className="px-3 py-2"><div className="font-medium text-gray-900">{(i.description_snapshot as string) || 'Item'}</div>{i.sku_snapshot ? <div className="text-xs text-gray-400">{i.sku_snapshot as string}</div> : null}</td>
                <td className="px-3 py-2 tabular-nums">{Number(i.quantity)}</td>
                <td className="px-3 py-2 tabular-nums">{Number(i.received_quantity)}</td>
                <td className="px-3 py-2 tabular-nums text-gray-700">{money(Number(i.unit_cost_cents))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
