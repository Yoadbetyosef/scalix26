import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { listOrders } from '@/lib/orders/store'
import { STAGE_LABELS, isTerminalStage } from '@/lib/orders/stages'

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
          <Link href="/settings/options" className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Dropdowns</Link>
          <Link href="/orders/board" className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Board</Link>
          <Link href="/orders/new" className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">+ New Order</Link>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">No orders yet. Create your first order.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <div className="min-w-[720px] text-sm">
            {/* SIX COLUMNS, NOT SEVEN. The seventh was an unlabelled cell holding a hardcoded blue
                "Open" — the open-this-order affordance, sitting immediately right of the real Stage
                column and reading as a status that never changed, because it was a string literal.
                The whole row has always been the link; it did not need a word to say so. */}
            <div className="grid grid-cols-[1.4fr_1.6fr_1fr_1fr_0.8fr_1fr] gap-x-4 bg-gray-50 px-4 py-2.5 font-medium text-gray-500">
              {['Order', 'Customer', 'Stage', 'Factory', 'Total', 'Requested'].map((h, i) => <div key={i}>{h}</div>)}
            </div>
            <div className="divide-y divide-gray-100">
              {orders.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`} className="grid grid-cols-[1.4fr_1.6fr_1fr_1fr_0.8fr_1fr] items-center gap-x-4 px-4 py-2.5 hover:bg-gray-50">
                  <div className="font-mono text-xs font-medium text-gray-900">{o.orderNumber}</div>
                  <div className="text-gray-800">{o.customerName ?? '—'}</div>
                  {/* The one column that IS a status. Terminal stages read quieter than live ones —
                      a finished job should not compete with the work still in front of her. */}
                  <div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${isTerminalStage(o.stage) ? 'bg-gray-50 text-gray-500' : 'bg-gray-100 text-gray-700'}`}>
                      {STAGE_LABELS[o.stage]}
                    </span>
                  </div>
                  <div className="text-gray-600">{o.factoryName ?? '—'}</div>
                  <div className="tabular-nums text-gray-800">{money(o.subtotalCents, o.currency)}</div>
                  <div className="text-gray-600">{o.requestedCompletionDate ?? '—'}</div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
