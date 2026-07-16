import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { listPOs } from '@/lib/commerce/purchase-orders'

export const dynamic = 'force-dynamic'
const money = (c: number, cur = 'usd') => `${cur === 'usd' ? '$' : ''}${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const STATUS: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', awaiting_approval: 'bg-amber-100 text-amber-700', approved: 'bg-blue-100 text-blue-700', sent_to_supplier: 'bg-blue-100 text-blue-700', partially_received: 'bg-amber-100 text-amber-700', received: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-gray-100 text-gray-500' }

export default async function PurchaseOrdersPage() {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const pos = await listPOs()
  return (
    <div className="mx-auto max-w-5xl px-6 pb-10">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Purchase Orders</h1>
      <p className="mb-5 text-sm text-gray-500">{pos.length} PO{pos.length === 1 ? '' : 's'} · create one from a customer order’s missing items.</p>
      {pos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">No purchase orders yet.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {pos.map((p) => (
            <Link key={p.id as string} href={`/commerce/purchase-orders/${p.id}`} className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50">
              <span className="font-mono text-xs text-gray-500">{p.po_number as string}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS[p.status as string] ?? 'bg-gray-100 text-gray-600'}`}>{(p.status as string).replace(/_/g, ' ')}</span>
              {p.approval_required !== 'none' ? <span className="text-[10px] text-amber-700">approval: {p.approval_required as string}</span> : null}
              {p.email_status === 'failed' ? <span className="text-[10px] text-red-600">email failed</span> : null}
              <span className="ml-auto tabular-nums text-gray-900">{money(Number(p.total_cost_cents), p.currency as string)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
