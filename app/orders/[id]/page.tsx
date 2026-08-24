import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { getOrder } from '@/lib/orders/store'
import { ArrowLeft, Lock } from 'lucide-react'
import { stageHue } from '@/lib/orders/stage-colors'
import { STAGE_LABELS, isProtectedStage, canEditWorkflow, canEditDocumentFacts } from '@/lib/orders/stages'
import { StageControl } from '@/components/orders/stage-control'
import { OrderEdit } from '@/components/orders/order-edit'
import { OrderDocumentEdit } from '@/components/orders/order-document-edit'
import { DeleteOrderButton } from '@/components/orders/delete-order'
import { AttachmentsPanel } from '@/components/orders/attachments-panel'
import { ApprovalActions } from '@/components/orders/approval-actions'
import { FinishActions } from '@/components/orders/finish-actions'
import { listTemplates } from '@/lib/orders/templates'
import { getSupplier } from '@/lib/orders/suppliers'

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
sent_to_production: 'Moved to production', moved_to_production: 'Moved to production', delivery_requested: 'Factory notified — invoice requested', factory_ready: 'Factory marked ready + invoice', attachment_added: 'Attachment added', note: 'Note' }

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const o = await getOrder((await params).id)
  // Empty when add_orders_6 has not been run — listTemplates() swallows a missing table on purpose,
  // so the picker simply does not appear rather than the page failing.
  const templates = o ? await listTemplates(o.tenantId) : []
  if (!o) notFound()

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
        {isProtectedStage(o.stage) && (
          <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-mute)' }}>
            <Lock style={{ width: 10, height: 10 }} /> Approval stage
          </span>
        )}
        {o.isCustomDesign && (
          <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t3)' }}>Custom design</span>
        )}
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
            customerName: o.customerName, customerEmail: o.customerEmail, customerPhone: o.customerPhone,
            factoryName: o.factoryName, factoryContactName: o.factoryContactName, factoryEmail: o.factoryEmail,
            assignedEmployee: o.assignedEmployee, orderDate: o.orderDate, requestedCompletionDate: o.requestedCompletionDate,
            depositCents: o.depositCents, currency: o.currency, internalNotes: o.internalNotes, publicNotes: o.publicNotes,
            deliveryProvince: o.deliveryProvince, taxKind: o.taxKind,
            pstExempt: o.pstExempt, pstExemptionNote: o.pstExemptionNote,
            documentTemplateId: o.documentTemplateId,
            templates: templates.map((t) => ({ id: t.id, name: t.name })),
            clientRequirements: o.clientRequirements, isCustomDesign: o.isCustomDesign,
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
        <StageControl orderId={o.id} stage={o.stage} />
        <hr />
        <DeleteOrderButton orderId={o.id} orderNumber={o.orderNumber} />
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
        <ApprovalActions orderId={o.id} stage={o.stage} orderSupplier={o.supplierId ? await getSupplier(o.supplierId) : null} prefill={{ factoryName: o.factoryContactName, factoryEmail: o.factoryEmail, customerName: o.customerName, customerEmail: o.customerEmail }} />
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
          {/* The kit's totals row: pairs right-aligned, tabular figures, the balance emphasised
              because it is the number anybody actually came to read. */}
          <dl className="v2-tot">
            <div><dt>Subtotal</dt><dd>{money(o.subtotalCents, o.currency)}</dd></div>
            <div><dt>Deposit</dt><dd>{money(o.depositCents, o.currency)}</dd></div>
            <div><dt>Balance</dt><dd>{money(o.balanceCents, o.currency)}</dd></div>
          </dl>
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

      <section style={{ marginTop: 24 }}>
        <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Attachments</p><s /></div>
        <AttachmentsPanel orderId={o.id} invoiceImageId={o.invoiceImageId} canSetInvoiceImage={canEditDocumentFacts(o.stage)} />
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
                  {e.payload?.to ? <span style={{ color: 'var(--v2-mute)' }}> → {STAGE_LABELS[e.payload.to as keyof typeof STAGE_LABELS] ?? String(e.payload.to)}</span> : null}
                  <p className="v2-kick" style={{ marginTop: 2 }}>{new Date(e.createdAt).toLocaleString()}{e.actor ? ` · ${e.actor}` : ''}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
