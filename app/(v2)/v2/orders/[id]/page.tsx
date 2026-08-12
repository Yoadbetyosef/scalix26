import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { getOrder } from '@/lib/orders/store'
import { listTemplates } from '@/lib/orders/templates'
import { getSupplier } from '@/lib/orders/suppliers'
import { STAGE_LABELS, isProtectedStage, isTerminalStage } from '@/lib/orders/stages'
import { DetailPage, type DetailFact, type DetailRow } from '../../detail'
import { PREVIEW } from '../../list-page'
import { orderLine } from './line'

// One order, reskinned. Every loader is the one /orders/[id] already calls — getOrder, listTemplates,
// getSupplier — so nothing new is fetched. READ-ONLY: the actions the real page offers are rendered
// and disabled with title="v2 preview".

export const dynamic = 'force-dynamic'

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 2 }).format(cents / 100)

const EVENT_LABEL: Record<string, string> = {
  created: 'Order created', updated: 'Order updated', stage_changed: 'Stage changed',
  approval_sent: 'Approval request sent', approval_opened: 'Approval link opened',
  approval_responded: 'Approval response received', approval_revoked: 'Approval revoked',
  sent_to_production: 'Moved to production', moved_to_production: 'Moved to production',
  delivery_requested: 'Factory notified — invoice requested', factory_ready: 'Factory marked ready + invoice',
  attachment_added: 'Attachment added', note: 'Note',
}

// Which party the order is currently waiting on, read straight off the stage machine's own names.
const WAITING_ON: Record<string, string> = {
  waiting_factory_approval: 'the factory', waiting_customer_approval: 'the customer',
  factory_changes_requested: 'changes from you', customer_changes_requested: 'changes from you',
  production: 'the factory to finish',
}

export default async function V2OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const o = await getOrder((await params).id)
  // Same comment as the real page: listTemplates swallows a missing table on purpose, so the picker
  // simply does not appear rather than the page failing.
  const templates = o ? await listTemplates(o.tenantId) : []
  if (!o) notFound()
  const supplier = o.supplierId ? await getSupplier(o.supplierId) : null

  const dueInDays = o.requestedCompletionDate
    ? Math.round((new Date(o.requestedCompletionDate).getTime() - Date.now()) / 86_400_000)
    : null

  const facts: DetailFact[] = [
    { label: 'Customer', value: o.customerName },
    { label: 'Email', value: o.customerEmail },
    { label: 'Phone', value: o.customerPhone },
    { label: 'Factory', value: supplier?.name ?? o.factoryName },
    { label: 'Ordered', value: o.orderDate },
    { label: 'Requested', value: o.requestedCompletionDate },
    { label: 'Estimated', value: o.estimatedCompletionDate },
    { label: 'Deposit', value: o.depositCents ? money(o.depositCents, o.currency) : null },
    { label: 'Subtotal', value: money(o.subtotalCents, o.currency) },
    { label: 'Template', value: templates.find((t) => t.id === o.documentTemplateId)?.name ?? null },
  ]

  const items: DetailRow[] = o.lineItems.map((l, i) => ({
    id: l.id,
    primary: `${i + 1}. ${l.productName}`,
    detail: [l.description, l.quantity > 1 ? `× ${l.quantity}` : null].filter(Boolean).join(' · ') || null,
    trailing: money(l.lineTotalCents, o.currency),
  }))

  const events: DetailRow[] = o.events.map((e) => ({
    id: e.id,
    primary: EVENT_LABEL[e.type] ?? e.type,
    detail: e.actor ?? null,
    trailing: new Date(e.createdAt).toISOString().slice(0, 10),
  }))

  return (
    <DetailPage
      backHref="/v2/orders"
      backLabel="Orders"
      eyebrow={o.orderNumber}
      title={o.customerName ?? 'Order'}
      chips={[
        { label: `${STAGE_LABELS[o.stage]}${isProtectedStage(o.stage) ? ' · locked' : ''}` },
        ...(o.isCustomDesign ? [{ label: 'Custom design', tone: 'accent' as const }] : []),
      ]}
      line={orderLine({
        stage: o.stage,
        stageLabel: STAGE_LABELS[o.stage],
        items: o.lineItems.length,
        waitingOn: WAITING_ON[o.stage] ?? null,
        dueInDays,
      })}
      // The same actions the real page offers, under the same conditions.
      actions={[
        ...(!isTerminalStage(o.stage) ? [{ label: 'Edit', tone: 'primary' as const, disabledReason: PREVIEW }] : []),
        { label: 'Estimate', disabledReason: PREVIEW },
        { label: 'Quote', disabledReason: PREVIEW },
        { label: 'Move stage', disabledReason: PREVIEW },
        { label: 'Delete', disabledReason: PREVIEW },
      ]}
      sections={[
        { title: 'Pieces', rows: items, empty: 'No line items on this order.' },
        { title: 'Details', facts },
        ...(o.clientRequirements ? [{ title: 'Client requirements', facts: [{ label: 'Notes', value: o.clientRequirements }] }] : []),
        { title: 'History', rows: events, empty: 'Nothing has happened yet.' },
      ]}
    />
  )
}
