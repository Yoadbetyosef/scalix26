import { notFound } from 'next/navigation'
import { PrintButton } from '@/components/studio/print-button'
import { OrderDocumentBody } from '@/components/orders/document-body'
import { loadOrderDocument } from '@/lib/orders/document-data'
import { resolveShare } from '@/lib/orders/shares'
import { ORDER_DOC_META } from '@/lib/orders/documents'

// The customer's copy of a document, at a token URL.
//
// No account, no session — the token IS the credential, the same way /approval/[token] and /d/[token]
// work. It renders the SAME body the owner prints, from the same loader, so the two cannot differ.
//
// ── IT SHOWS PRICES AND ASKS FOR NOTHING ────────────────────────────────────────────────────────────
//
// That is what makes it an estimate rather than an approval request. /approval/[token] deliberately
// omits money and asks the recipient to decide; this shows the money and offers no decision at all.
// Mixing them would produce a page that asks somebody to approve a number — which is a contract, and
// not what a printed estimate is.

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  try {
    const share = await resolveShare((await params).token)
    if (!share) return { title: 'Document', robots: { index: false, follow: false } }
    const data = await loadOrderDocument(share.tenantId, share.orderId, share.docType)
    const label = ORDER_DOC_META[share.docType]?.title ?? 'Document'
    // The tenant's name, never ours — see lib/documents/routes.ts.
    return {
      title: [data?.business.businessName, label].filter(Boolean).join(' · ') || label,
      robots: { index: false, follow: false },
    }
  } catch {
    return { title: 'Document', robots: { index: false, follow: false } }
  }
}

export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const share = await resolveShare((await params).token)
  // One 404 for every failure — malformed, unknown, revoked, expired. Telling an anonymous caller
  // which it was is free information for somebody guessing tokens.
  if (!share) notFound()

  const data = await loadOrderDocument(share.tenantId, share.orderId, share.docType)
  if (!data) notFound()

  return (
    <OrderDocumentBody
      order={data.order}
      type={share.docType}
      branding={data.branding}
      business={data.business}
      images={data.images}
      tax={data.tax}
      pstExemptionNote={data.pstExemptionNote}
      footerNote={data.footerNote}
      // Print only. No branding editor, no Send — this is the recipient's copy, and the one thing
      // they may reasonably want is a PDF of it.
      toolbar={<PrintButton />}
    />
  )
}
