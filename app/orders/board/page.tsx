import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { listOrders } from '@/lib/orders/store'
import { ORDER_STAGES, STAGE_LABELS, isProtectedStage, type OrderStage } from '@/lib/orders/stages'

export const dynamic = 'force-dynamic'
const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

// Kanban view. Columns are the workflow stages; approval columns are marked (their cards move only via the
// order's workflow actions, not free drag). Cards link to the order for actions.
export default async function OrdersBoardPage() {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const orders = await listOrders()
  const byStage = (s: OrderStage) => orders.filter((o) => o.stage === s)

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Orders — Board</h1>
        <div className="flex gap-2">
          <Link href="/orders" className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Table</Link>
          <Link href="/orders/new" className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">+ New Order</Link>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {/* Terminal stages get no column — a board column that only ever accumulates is a list, not a
            stage of work. 'closed' joins 'cancelled' here; both are still on /orders. */}
        {ORDER_STAGES.filter((s) => s !== 'cancelled' && s !== 'closed').map((s) => (
          <div key={s} className="w-64 shrink-0 rounded-xl border border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
              <span className="text-xs font-semibold text-gray-700">{STAGE_LABELS[s]}</span>
              <span className="flex items-center gap-1 text-[10px] text-gray-400">{byStage(s).length}{isProtectedStage(s) && <span title="Approval stage — moves via workflow actions only">🔒</span>}</span>
            </div>
            <div className="space-y-2 p-2">
              {byStage(s).map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`} className="block rounded-lg border border-gray-200 bg-white p-2.5 hover:border-gray-300">
                  <div className="font-mono text-[11px] text-gray-500">{o.orderNumber}</div>
                  <div className="text-sm font-medium text-gray-900">{o.customerName ?? 'No customer'}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{money(o.subtotalCents)}{o.factoryName ? ` · ${o.factoryName}` : ''}</div>
                </Link>
              ))}
              {byStage(s).length === 0 && <div className="px-1 py-2 text-[11px] text-gray-400">—</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
