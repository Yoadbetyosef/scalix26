import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { getOrder } from '@/lib/orders/store'
import { STAGE_LABELS, isProtectedStage, isTerminalStage } from '@/lib/orders/stages'
import { StageControl } from '@/components/orders/stage-control'
import { OrderEdit } from '@/components/orders/order-edit'
import { DeleteOrderButton } from '@/components/orders/delete-order'
import { AttachmentsPanel } from '@/components/orders/attachments-panel'
import { ApprovalActions } from '@/components/orders/approval-actions'

export const dynamic = 'force-dynamic'
const money = (c: number, cur = 'usd') => `${cur === 'usd' ? '$' : ''}${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
// One-line human summary of a line item's jewelry spec, e.g.
// "1.25ct Round Natural Diamond VS1 G · 0.50ct side Baguette · 14K White Gold · size 6.5"
const specLine = (l: import('@/lib/orders/types').OrderLineItem): string => {
  const center = [l.centerStoneCarat ? `${l.centerStoneCarat}ct` : null, l.centerStoneShape, l.stoneOrigin, l.stoneType, l.stoneQuality, l.stoneColor].filter(Boolean).join(' ')
  const side = [l.sideStoneCaratTotal ? `${l.sideStoneCaratTotal}ct side` : null, l.sideStoneShape].filter(Boolean).join(' ')
  return [center, side, l.metalKarat, l.measurements, l.color, l.material, l.customSpec].filter(Boolean).join(' · ')
}
const EVENT_LABEL: Record<string, string> = { created: 'Order created', updated: 'Order updated', stage_changed: 'Stage changed', approval_sent: 'Approval request sent', approval_opened: 'Approval link opened', approval_responded: 'Approval response received', approval_revoked: 'Approval revoked', sent_to_production: 'Sent to production', delivery_requested: 'Factory notified — invoice requested', factory_ready: 'Factory marked ready + invoice', attachment_added: 'Attachment added', note: 'Note' }

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const o = await getOrder((await params).id)
  if (!o) notFound()

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4"><Link href="/orders" className="text-sm text-gray-500 hover:underline">← Orders</Link></div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-gray-500">{o.orderNumber}</div>
          <h1 className="text-2xl font-semibold text-gray-900">{o.customerName ?? 'Order'}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">{STAGE_LABELS[o.stage]}{isProtectedStage(o.stage) && ' 🔒'}</span>
            {o.isCustomDesign && <span className="inline-block rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800">Custom design</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isTerminalStage(o.stage) && (
            <OrderEdit orderId={o.id} initial={{
              orderNumber: o.orderNumber, contactId: o.contactId,
              customerName: o.customerName, customerEmail: o.customerEmail, customerPhone: o.customerPhone,
              factoryName: o.factoryName, factoryContactName: o.factoryContactName, factoryEmail: o.factoryEmail,
              assignedEmployee: o.assignedEmployee, orderDate: o.orderDate, requestedCompletionDate: o.requestedCompletionDate,
              depositCents: o.depositCents, currency: o.currency, internalNotes: o.internalNotes, publicNotes: o.publicNotes,
              clientRequirements: o.clientRequirements, isCustomDesign: o.isCustomDesign,
              lineItems: o.lineItems,
            }} />
          )}
          {/* Open in a new tab: the document is a print-to-PDF page, not a place to navigate away to. */}
          <Link href={`/orders/${o.id}/document/estimate`} target="_blank" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Estimate</Link>
          <Link href={`/orders/${o.id}/document/quote`} target="_blank" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Quote</Link>
          <StageControl orderId={o.id} stage={o.stage} />
          <DeleteOrderButton orderId={o.id} orderNumber={o.orderNumber} />
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Approval workflow</h3>
        <ApprovalActions orderId={o.id} stage={o.stage} prefill={{ factoryName: o.factoryContactName, factoryEmail: o.factoryEmail, customerName: o.customerName, customerEmail: o.customerEmail }} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 md:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Line items</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-gray-500"><tr>{['Product', 'Qty', 'Specs', 'Unit', 'Total'].map((h) => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {o.lineItems.map((l) => (
                  <tr key={l.id}>
                    <td className="px-2 py-1.5"><div className="font-medium text-gray-900">{l.productName}</div>{l.description && <div className="text-xs text-gray-500">{l.description}</div>}</td>
                    <td className="px-2 py-1.5 tabular-nums">{l.quantity}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-600">{specLine(l) || '—'}</td>
                    <td className="px-2 py-1.5 tabular-nums">{money(l.unitPriceCents, o.currency)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{money(l.lineTotalCents, o.currency)}</td>
                  </tr>
                ))}
                {o.lineItems.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-gray-400">No line items</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end gap-6 text-sm"><span className="text-gray-500">Subtotal <span className="font-medium text-gray-900">{money(o.subtotalCents, o.currency)}</span></span><span className="text-gray-500">Deposit <span className="font-medium text-gray-900">{money(o.depositCents, o.currency)}</span></span><span className="text-gray-500">Balance <span className="font-medium text-gray-900">{money(o.balanceCents, o.currency)}</span></span></div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Details</h3>
            <dl className="space-y-1.5 text-gray-600">
              <div className="flex justify-between"><dt>Customer email</dt><dd className="text-gray-900">{o.customerEmail ?? '—'}</dd></div>
              <div className="flex justify-between"><dt>Factory</dt><dd className="text-gray-900">{o.factoryName ?? '—'}</dd></div>
              <div className="flex justify-between"><dt>Factory email</dt><dd className="text-gray-900">{o.factoryEmail ?? '—'}</dd></div>
              <div className="flex justify-between"><dt>Requested</dt><dd className="text-gray-900">{o.requestedCompletionDate ?? '—'}</dd></div>
              <div className="flex justify-between"><dt>Est. completion</dt><dd className="text-gray-900">{o.estimatedCompletionDate ?? '—'}</dd></div>
            </dl>
          </div>
          {o.clientRequirements && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm">
              <h3 className="mb-1 text-sm font-semibold text-violet-900">Client requirements</h3>
              <p className="whitespace-pre-wrap text-violet-900/80">{o.clientRequirements}</p>
            </div>
          )}
          {o.publicNotes && <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm"><h3 className="mb-1 text-sm font-semibold text-gray-900">Public notes</h3><p className="text-gray-600">{o.publicNotes}</p></div>}
          {o.internalNotes && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><h3 className="mb-1 text-sm font-semibold text-amber-900">Internal notes (never shared)</h3><p className="text-amber-800">{o.internalNotes}</p></div>}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Attachments</h3>
        <AttachmentsPanel orderId={o.id} />
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Activity</h3>
        <ul className="space-y-2">
          {o.events.map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
              <div><span className="text-gray-900">{EVENT_LABEL[e.type] ?? e.type}</span>{e.payload?.to ? <span className="text-gray-500"> → {STAGE_LABELS[e.payload.to as keyof typeof STAGE_LABELS] ?? String(e.payload.to)}</span> : null}<div className="text-xs text-gray-400">{new Date(e.createdAt).toLocaleString()}{e.actor ? ` · ${e.actor}` : ''}</div></div>
            </li>
          ))}
          {o.events.length === 0 && <li className="text-sm text-gray-400">No activity yet.</li>}
        </ul>
      </div>
    </div>
  )
}
