import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { getOrder } from '@/lib/orders/store'
import { isOrderDocType, loadDocContext } from '@/lib/orders/documents'
import { PrintButton } from '@/components/studio/print-button'
import { DocumentBranding } from '@/components/orders/document-branding'
import { SendDocument } from '@/components/orders/send-document'
import { OrderDocumentBody } from '@/components/orders/document-body'
import { loadOrderDocument } from '@/lib/orders/document-data'

// The owner's copy. The customer's copy is /e/[token], and both render the same body from the same
// loader — see components/orders/document-body.tsx for why that matters.

// ── THE PAGE TITLE IS THE TENANT'S, AND ONLY THE TENANT'S ───────────────────────────────────────────
//
// Chrome prints document.title at the top of every printed page. This route used to inherit the root
// layout's "<platform> — AI Employee Platform", so every estimate a customer received had our name
// printed across the top of it.
export async function generateMetadata({ params }: { params: Promise<{ id: string; type: string }> }) {
  try {
    const a = await requireOrdersAccess()
    if (!a) return { title: '' }
    const { id, type } = await params
    const [order, { business }] = await Promise.all([getOrder(id), loadDocContext(a.tenantId)])
    const label = type.charAt(0).toUpperCase() + type.slice(1)
    const num = order?.orderNumber ? ` ${order.orderNumber}` : ''
    return { title: [business.businessName, `${label}${num}`].filter(Boolean).join(' · '), robots: { index: false, follow: false } }
  } catch {
    // A title is not worth failing a document render over.
    return { title: '' }
  }
}

export default async function OrderDocumentPage({ params }: { params: Promise<{ id: string; type: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const { id, type } = await params
  if (!isOrderDocType(type)) notFound()

  const data = await loadOrderDocument(a.tenantId, id)
  if (!data) notFound()

  return (
    <OrderDocumentBody
      order={data.order}
      type={type}
      branding={data.branding}
      business={data.business}
      images={data.images}
      tax={data.tax}
      pstExemptionNote={data.pstExemptionNote}
      footerNote={data.footerNote}
      toolbar={
        <>
          {/* No destination province, no tax line. Said out loud rather than silently omitted: an
              invoice missing its tax is not obviously wrong to look at, and the number a customer
              would compute themselves would not match. */}
          {!data.tax && data.order.subtotalCents > 0 && (
            <span className="mr-auto text-xs text-amber-700">
              No tax shown — set the delivery province on this order to charge by place of supply.
            </span>
          )}
          {data.templateName && <span className="mr-1 text-xs text-neutral-400">{data.templateName}</span>}
          <SendDocument
            orderId={id}
            docType={type}
            defaultEmail={data.order.customerEmail}
            defaultName={data.order.customerName}
          />
          <DocumentBranding needsLogo={!data.branding.logoUrl} />
          <PrintButton />
        </>
      }
    />
  )
}
