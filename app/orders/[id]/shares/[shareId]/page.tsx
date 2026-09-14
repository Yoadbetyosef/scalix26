import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { createAdminClient } from '@/lib/supabase/server'
import { OrderDocumentBody } from '@/components/orders/document-body'
import { PrintButton } from '@/components/studio/print-button'
import { readDocumentSnapshot, documentDataFromSnapshot } from '@/lib/orders/document-snapshot'
import { loadOrderDocument } from '@/lib/orders/document-data'
import { signedAttachmentUrl } from '@/lib/orders/attachments'
import { isOrderDocType } from '@/lib/orders/documents'

// THE COPY AS SENT — the owner's view of exactly what a customer holds behind one link.
//
// The internal document page is live. This page is not: it renders the snapshot frozen when the
// link was minted, so "what did I send Irina on the 12th?" has an answer that does not depend on
// what the order says today. Links minted before snapshots existed say so and show the live order.
export const dynamic = 'force-dynamic'

export default async function SentCopyPage({ params }: { params: Promise<{ id: string; shareId: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  const { id, shareId } = await params
  const { data: share } = await createAdminClient().from('order_document_shares')
    .select('id, doc_type, recipient_name, recipient_email, sent_at, created_at, revoked_at')
    .eq('tenant_id', a.tenantId).eq('order_id', id).eq('id', shareId).maybeSingle()
  if (!share || !isOrderDocType(share.doc_type)) notFound()

  const snap = await readDocumentSnapshot(a.tenantId, id, shareId)
  const data = snap
    ? await documentDataFromSnapshot(snap, signedAttachmentUrl, a.tenantId, id)
    : await loadOrderDocument(a.tenantId, id, share.doc_type)
  if (!data) notFound()
  const who = share.recipient_email === 'link' ? 'a copied link' : (share.recipient_name || share.recipient_email)
  const when = new Date((share.sent_at ?? share.created_at) as string).toLocaleString()

  return (
    <OrderDocumentBody
      order={data.order} type={share.doc_type} branding={data.branding} business={data.business}
      images={data.images} files={data.files} tax={data.tax} pstExemptionNote={data.pstExemptionNote} footerNote={data.footerNote}
      toolbar={
        <>
          <span className="mr-auto text-xs text-neutral-600">
            {snap
              ? <>Copy as sent to <b>{who}</b> on {when}{share.revoked_at ? ' · link since withdrawn' : ''}. Edits to the order do not change this copy.</>
              : <>Sent to <b>{who}</b> on {when}, before copies were kept — this shows the order as it is <b>now</b>.</>}
          </span>
          <Link href={`/orders/${id}`} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">Back to order</Link>
          <PrintButton />
        </>
      }
    />
  )
}
