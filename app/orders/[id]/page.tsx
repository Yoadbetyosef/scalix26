import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { getOrder } from '@/lib/orders/store'
import { ArrowLeft, Lock } from 'lucide-react'
import { stageHue } from '@/lib/orders/stage-colors'
import { STAGE_LABELS, STATUS_GROUP_LABELS, isProtectedStage, canEditWorkflow, canEditDocumentFacts, orderStatusGroup } from '@/lib/orders/stages'
import { StageControl } from '@/components/orders/stage-control'
import { OrderEdit } from '@/components/orders/order-edit'
import { OrderDocumentEdit } from '@/components/orders/order-document-edit'
import { DeleteOrderButton } from '@/components/orders/delete-order'
import { AttachmentsPanel } from '@/components/orders/attachments-panel'
import { ApprovalActions } from '@/components/orders/approval-actions'
import { FinishActions } from '@/components/orders/finish-actions'
import { InvoiceButton } from '@/components/orders/invoice-button'
import { PaymentsPanel } from '@/components/orders/payments-panel'
import { PurchasesPanel } from '@/components/orders/purchases-panel'
import { listPurchases } from '@/lib/orders/purchases'
import { SharedLinks } from '@/components/orders/shared-links'
import { LinkCustomer } from '@/components/orders/link-customer'
import { listTemplates } from '@/lib/orders/templates'
import { getSupplier } from '@/lib/orders/suppliers'
import { deletable } from '@/lib/orders/store'
import { listOrderPayments, orderTotals, sumPayments, LEGACY_DEPOSIT_NOTE } from '@/lib/orders/payments'
import { resolveOrderTax } from '@/lib/orders/document-data'
import { actorLabels, actorLabel } from '@/lib/orders/actors'
import { ORDER_KIND_LABELS, APPRAISAL_PURPOSE_LABELS, kindWords } from '@/lib/orders/kinds'
import { PAYMENT_METHOD_LABELS, isOrderPaymentMethod } from '@/lib/orders/payments'
import { getSchemaCapabilities, stageSupported } from '@/lib/db/capabilities'
import { ORDER_STAGES } from '@/lib/orders/stages'

export const dynamic = 'force-dynamic'
const money = (c: number, cur = 'usd') => `${cur === 'usd' ? '$' : ''}${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
// One-line human summary of a line item's jewelry spec, e.g.
// "1.25ct Round Natural Diamond VS1 G · 0.50ct side Baguette · 14K White Gold · size 6.5"
const specLine = (l: import('@/lib/orders/types').OrderLineItem): string => {
  const center = [l.centerStoneCarat ? `${l.centerStoneCarat}ct` : null, l.centerStoneShape, l.stoneOrigin, l.stoneType, l.stoneQuality, l.stoneColor].filter(Boolean).join(' ')
  const side = [l.sideStoneCaratTotal ? `${l.sideStoneCaratTotal}ct side` : null, l.sideStoneShape].filter(Boolean).join(' ')
  return [center, side, l.certificateLab ? `${l.certificateLab} cert` : null, l.metalKarat, l.ringSize ? `size ${l.ringSize}` : null, l.measurements, l.color, l.material, l.customSpec].filter(Boolean).join(' · ')
}
const EVENT_LABEL: Record<string, string> = { created: 'Order created', updated: 'Order updated', stage_changed: 'Stage changed', approval_sent: 'Approval request sent', approval_opened: 'Approval link opened', approval_responded: 'Approval response received', approval_revoked: 'Approval revoked', // 'sent_to_production' is the historic name and stays mapped for rows already written. It claimed a send
// that only sometimes happened, so new rows are 'moved_to_production' — which is what the action does.
// A real send is recorded separately as 'delivery_requested'.
sent_to_production: 'Moved to production', moved_to_production: 'Moved to production', delivery_requested: 'Factory notified — invoice requested', factory_ready: 'Factory marked ready + invoice', attachment_added: 'Attachment added', note: 'Note',
  invoice_raised: 'Invoice raised', archived_to_inventory: 'Added to catalog', share_revoked: 'Document link withdrawn',
  document_shared: 'Document sent', payment_recorded: 'Payment recorded', payment_removed: 'Payment removed', contact_linked: 'Linked to customer',
  purchase_added: 'Purchase added', purchase_status: 'Purchase updated', purchase_removed: 'Purchase removed', contact_unlinked: 'Unlinked from customer' }

// The sentence the timeline prints for one event. Stage changes say from → to and the reason; money
// says how much and how; a sent document says which. The raw uuid that used to follow every line is
// resolved to a name by actorLabels.
function eventLine(e: import('@/lib/orders/types').OrderEvent): string {
  const p = e.payload ?? {}
  const stage = (v: unknown) => STAGE_LABELS[v as keyof typeof STAGE_LABELS] ?? String(v ?? '')
  switch (e.type) {
    case 'stage_changed': return `${p.from ? `${stage(p.from)} → ` : ''}${stage(p.to)}${p.note ? ` — ${p.note}` : ''}`
    case 'payment_recorded': {
      const cents = Number(p.amountCents ?? 0)
      const method = isOrderPaymentMethod(p.method) ? ` by ${PAYMENT_METHOD_LABELS[p.method].toLowerCase()}` : ''
      return `${p.kind === 'refund' ? 'Refund' : p.kind === 'deposit' ? 'Deposit' : 'Payment'} ${(Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}${method}${p.reference ? ` (${p.reference})` : ''}`
    }
    case 'payment_removed': return `${(Math.abs(Number(p.amountCents ?? 0)) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} taken off the order`
    case 'document_shared': return `${String(p.docType ?? 'document').replace(/^./, (c) => c.toUpperCase())}${p.via === 'link' ? ' — link copied' : ' — emailed'}`
    case 'attachment_added': return String(p.fileName ?? '')
    case 'purchase_added': return [p.description, p.supplier ? `from ${p.supplier}` : null].filter(Boolean).join(' ')
    case 'purchase_status': return `${p.description ?? ''}: ${String(p.from ?? '').replace('_', ' ')} → ${String(p.to ?? '').replace('_', ' ')}`
    case 'purchase_removed': return String(p.description ?? '')
    case 'contact_linked': return p.manual ? 'chosen by staff' : p.created ? 'new customer record created from the order' : 'matched by email or phone'
    case 'approval_responded': return `${String(p.approvalType ?? '')}: ${String(p.decision ?? '').replace('_', ' ')}`
    default: return p.to ? `→ ${stage(p.to)}` : ''
  }
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const o = await getOrder((await params).id)
  // Empty when add_orders_6 has not been run — listTemplates() swallows a missing table on purpose,
  // so the picker simply does not appear rather than the page failing.
  const templates = o ? await listTemplates(o.tenantId) : []
  if (!o) notFound()
  const [payments, tax, canDelete, labels, purchases, caps] = await Promise.all([
    listOrderPayments(o.id), resolveOrderTax(o), deletable(o.id), actorLabels(o.events.map((e) => e.actor)), listPurchases(o.id), getSchemaCapabilities(),
  ])
  const unavailableStages = ORDER_STAGES.filter((st) => !stageSupported(caps, st))
  // An order from before the ledger shows its typed deposit as one line, until add_tg_production_1.sql
  // (or the first recorded payment) carries it into the ledger.
  const shownPayments = payments.length === 0 && o.depositCents > 0
    ? [{ id: 'legacy', kind: 'deposit' as const, amountCents: o.depositCents, currency: o.currency, method: null, reference: null, note: LEGACY_DEPOSIT_NOTE, paidOn: o.orderDate ?? o.createdAt.slice(0, 10), createdAt: o.createdAt, createdBy: null }]
    : payments
  const totals = orderTotals(o, { taxCents: tax?.amountCents ?? 0, paidCents: payments.length ? sumPayments(payments) : o.depositCents })
  const group = orderStatusGroup(o.stage)

  return (
    <div className="v2 v2-embedded mx-auto max-w-4xl p-4 sm:p-6">
      {/* Back, the order number, the customer, and what state it is in — the same header shape
          /inbox/[id] and /contacts/[id] use. The 24px title stays here and only here: on a detail
          screen the subject's NAME is the title, which is a different thing from a page header
          repeating the rail's word. */}
      <div className="v2-head" style={{ alignItems: 'center', marginBottom: 16 }}>
        <Link href="/orders" className="v2-ico tap-target" aria-label="Back to orders"><ArrowLeft /></Link>
        <div className="min-w-0" style={{ flex: 1 }}>
          <p className="v2-kick">{o.orderNumber}</p>
          <h1 className="truncate" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--v2-ink)', marginTop: 2 }}>
            {o.customerName ?? 'Order'}
          </h1>
        </div>
        <span className="v2-stat" style={{ ['--chan' as string]: stageHue(o.stage) }}>
          {STAGE_LABELS[o.stage]}
        </span>
        {/* The summary the stage rolls up to — "Closed Order" on a completed or finished job, so a
            closed order never reads as open on the one page that describes it. Only shown when it
            says something the stage chip does not. */}
        {group !== 'active' && (
          <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>{STATUS_GROUP_LABELS[group]}</span>
        )}
        {isProtectedStage(o.stage) && (
          <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>
            <Lock style={{ width: 10, height: 10 }} /> Approval stage
          </span>
        )}
        {o.isCustomDesign && (
          <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t3)' }}>Custom design</span>
        )}
        {o.orderKind && o.orderKind !== 'custom' && (
          <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t1)' }}>{ORDER_KIND_LABELS[o.orderKind]}{o.orderKind === 'appraisal' && o.kindDetails?.purpose ? ` · ${APPRAISAL_PURPOSE_LABELS[o.kindDetails.purpose]}` : ''}</span>
        )}
      </div>

      {/* Who this order belongs to. A linked order offers the customer's page and an undo; an
          unlinked one says so and offers the address book. */}
      <div style={{ marginBottom: 16 }}>
        <LinkCustomer orderId={o.id} contactId={o.contactId} customerName={o.customerName} customerCompany={o.customerCompany ?? null} />
      </div>

      {/* THE ACTION BAR, with the separator that is its whole point: everything after the hairline
          changes something that cannot be put back. v1 put six equally-weighted boxes in a row and
          made two of them red, so Delete order was exactly as easy to hit as Estimate. */}
      <div className="v2-bar" style={{ marginBottom: 24 }}>
        {/* TWO GATES, NOT ONE. The full drawer is workflow and closes when the job ends. Tax is a
            fact about a document that exists, and it is the fact most likely to be missing at that
            exact moment — so it stays open on finished and completed, and shuts on cancelled,
            where there is no document to be right about. See lib/orders/stages.ts. */}
        {canEditWorkflow(o.stage) ? (
          <OrderEdit orderId={o.id} initial={{
            orderNumber: o.orderNumber, contactId: o.contactId,
            customerName: o.customerName, customerCompany: o.customerCompany, customerEmail: o.customerEmail, customerPhone: o.customerPhone,
            factoryName: o.factoryName, factoryContactName: o.factoryContactName, factoryEmail: o.factoryEmail,
            assignedEmployee: o.assignedEmployee, orderDate: o.orderDate, requestedCompletionDate: o.requestedCompletionDate,
            depositCents: o.depositCents, currency: o.currency, internalNotes: o.internalNotes, publicNotes: o.publicNotes,
            deliveryProvince: o.deliveryProvince, taxKind: o.taxKind,
            pstExempt: o.pstExempt, pstExemptionNote: o.pstExemptionNote,
            documentTemplateId: o.documentTemplateId,
            templates: templates.map((t) => ({ id: t.id, name: t.name })),
            clientRequirements: o.clientRequirements, isCustomDesign: o.isCustomDesign,
            orderKind: o.orderKind, kindDetails: o.kindDetails, supportsKinds: caps.orderKinds,
            lineItems: o.lineItems,
          }} />
        ) : canEditDocumentFacts(o.stage) ? (
          <OrderDocumentEdit
            orderId={o.id}
            stage={STAGE_LABELS[o.stage].toLowerCase()}
            initial={{
              deliveryProvince: o.deliveryProvince, taxKind: o.taxKind,
              pstExempt: o.pstExempt, pstExemptionNote: o.pstExemptionNote,
            }}
          />
        ) : null}
        {/* Open in a new tab: the document is a print-to-PDF page, not a place to navigate away to. */}
        <Link href={`/orders/${o.id}/document/estimate`} target="_blank" className="v2-act">Estimate ↗</Link>
        <Link href={`/orders/${o.id}/document/quote`} target="_blank" className="v2-act">Quote ↗</Link>
        {/* The invoice at ANY stage but cancelled — see raiseInvoice. A deposit is invoiced the day it
            is taken; the balance is collected months later against the same document. */}
        {canEditDocumentFacts(o.stage) && <InvoiceButton orderId={o.id} invoicedAt={o.invoicedAt} />}
        <StageControl orderId={o.id} stage={o.stage} unavailable={unavailableStages} />
        {/* Delete only while the order is an untouched draft — see `deletable`. Once a link has gone
            out or money has come in, the endings are Close / Cancel, which keep everything. */}
        {canDelete.ok && (
          <>
            <hr />
            <DeleteOrderButton orderId={o.id} orderNumber={o.orderNumber} />
          </>
        )}
      </div>

      <section style={{ marginBottom: 24 }}>
        <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Approval workflow</p><s /></div>
        {/* A finished job had nowhere to go, so finished work was re-typed into another system. */}
        {/* Both finished states, because invoicing is INDEPENDENT of how the job ended. Finishing an
            order neither raises an invoice nor forbids one later — see finish.ts. */}
        {(o.stage === 'completed' || o.stage === 'finished') && (
          <div className="mb-4">
            <FinishActions orderId={o.id} invoicedAt={o.invoicedAt} archivedAt={o.archivedAt} />
          </div>
        )}
        <ApprovalActions orderId={o.id} stage={o.stage} orderSupplier={o.supplierId ? await getSupplier(o.supplierId) : null} prefill={{ factoryName: o.factoryContactName, factoryEmail: o.factoryEmail, customerName: o.customerName, customerEmail: o.customerEmail }} supportsQuotation={caps.vendorQuotation} />
      </section>

      <div className="grid gap-6 md:grid-cols-3">
        <section className="md:col-span-2">
          <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Line items · {o.lineItems.length}</p><s /></div>
          <div className="overflow-x-auto">
            <table className="v2-tbl">
              <thead><tr>{['Product', 'Qty', 'Specs', 'Unit', 'Total'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {o.lineItems.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 500, color: 'var(--v2-ink)' }}>{l.productName}</div>
                      {l.description && <div className="v2-hint">{l.description}</div>}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{l.quantity}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--v2-mute)' }}>{specLine(l) || '—'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{money(l.unitPriceCents, o.currency)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{money(l.lineTotalCents, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {o.lineItems.length === 0 && (
              <div className="v2-card" data-empty style={{ marginTop: 12 }}>
                <b>No line items</b><span>Use Edit order to add what is being made.</span>
              </div>
            )}
          </div>
          {/* Subtotal, tax, total, paid and balance due — the same five figures the invoice prints,
              from the same arithmetic (orderTotals), with every payment underneath. */}
          <div style={{ marginTop: 20 }}>
            <PaymentsPanel orderId={o.id} currency={o.currency} totals={totals} payments={shownPayments} canRecord={o.stage !== 'cancelled'} />
          </div>
        </section>

        <div className="space-y-6">
          <section>
            <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Details</p><s /></div>
            <dl className="v2-facts" data-narrow>
              <div><dt>Customer email</dt><dd>{o.customerEmail ?? '—'}</dd></div>
              <div><dt>Factory</dt><dd>{o.factoryName ?? '—'}</dd></div>
              <div><dt>Factory email</dt><dd>{o.factoryEmail ?? '—'}</dd></div>
              <div><dt>Requested</dt><dd>{o.requestedCompletionDate ?? '—'}</dd></div>
              <div><dt>Est. completion</dt><dd>{o.estimatedCompletionDate ?? '—'}</dd></div>
            </dl>
          </section>

          {/* Three notes, three tinted blocks in v1 — violet, white, amber. They are the kit's card
              with a hued micro-label instead: the label says whose words these are and whether they
              leave the building, which is the only thing the tint was ever encoding. */}
          {(o.orderKind === 'repair' || o.orderKind === 'appraisal') && (o.kindDetails?.itemDescription || o.kindDetails?.repairRequested || o.kindDetails?.appraiser) && (
            <section>
              <div className="v2-head" style={{ marginBottom: 10 }}><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />{ORDER_KIND_LABELS[o.orderKind]}</p><s /></div>
              <dl className="v2-facts" data-narrow>
                {o.kindDetails?.itemDescription && <div><dt>{kindWords(o.orderKind).piece}</dt><dd>{o.kindDetails.itemDescription}</dd></div>}
                {o.kindDetails?.repairRequested && <div><dt>{kindWords(o.orderKind).brief}</dt><dd className="whitespace-pre-wrap">{o.kindDetails.repairRequested}</dd></div>}
                {o.kindDetails?.appraiser && <div><dt>Appraiser</dt><dd>{o.kindDetails.appraiser}</dd></div>}
              </dl>
            </section>
          )}
          {o.clientRequirements && (
            <section>
              <div className="v2-head" style={{ marginBottom: 10 }}>
                <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Client requirements</p><s />
              </div>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--v2-ink)' }}>{o.clientRequirements}</p>
            </section>
          )}
          {o.publicNotes && (
            <section>
              <div className="v2-head" style={{ marginBottom: 10 }}><p className="v2-kick"><i />Public notes</p><s /></div>
              <p className="text-sm" style={{ color: 'var(--v2-ink)' }}>{o.publicNotes}</p>
              <p className="v2-hint" style={{ marginTop: 4 }}>Visible on the approval page.</p>
            </section>
          )}
          {o.internalNotes && (
            <section>
              <div className="v2-head" style={{ marginBottom: 10 }}>
                <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />Internal notes</p>
                <s />
                <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t4)' }}>never shared</span>
              </div>
              <p className="text-sm" style={{ color: 'var(--v2-ink)' }}>{o.internalNotes}</p>
            </section>
          )}
        </div>
      </div>

      {/* What was bought from suppliers to make the piece — the stone, the mounting — each with its
          own status, so "waiting for the stone" is recorded on the stone rather than guessed from
          the order's stage. Internal: costs never reach a customer document. */}
      <section style={{ marginTop: 24 }}>
        <PurchasesPanel orderId={o.id} currency={o.currency} purchases={purchases.purchases} missing={purchases.missing} canEdit={canEditWorkflow(o.stage)} />
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Attachments</p><s /></div>
        <AttachmentsPanel orderId={o.id} invoiceImageId={o.invoiceImageId} canSetInvoiceImage={canEditDocumentFacts(o.stage)} />
      </section>

      {/* Sits directly after Attachments and before Activity: what has LEFT the building, between
          the material she attached and the log of what happened to it. Renders nothing at all until
          a link has actually been sent. */}
      <section style={{ marginTop: 24 }}>
        <SharedLinks orderId={o.id} />
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Activity · {o.events.length}</p><s /></div>
        {o.events.length === 0 ? (
          <div className="v2-card" data-empty><b>No activity yet</b><span>Every stage change and approval will be listed here.</span></div>
        ) : (
          <ul className="space-y-2.5">
            {o.events.map((e) => (
              <li key={e.id} className="flex items-start gap-2.5 text-sm">
                <span style={{ marginTop: 7, width: 5, height: 5, flex: 'none', borderRadius: '50%', background: 'var(--v2-line-strong)' }} />
                <div>
                  <span style={{ color: 'var(--v2-ink)' }}>{EVENT_LABEL[e.type] ?? e.type}</span>
                  {eventLine(e) ? <span style={{ color: 'var(--v2-mute)' }}> · {eventLine(e)}</span> : null}
                  <p className="v2-kick" style={{ marginTop: 2 }}>{new Date(e.createdAt).toLocaleString()} · {actorLabel(labels, e.actor)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
