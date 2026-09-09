import { notFound } from 'next/navigation'
import { PrintButton } from '@/components/studio/print-button'
import { OrderDocumentBody } from '@/components/orders/document-body'
import { loadOrderDocument } from '@/lib/orders/document-data'
import { resolveShare, shareLinkRevoked } from '@/lib/orders/shares'
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

// A LINK THE BUSINESS WITHDREW SAYS SO. AN UNKNOWN ONE STILL DOES NOT.
//
// The rule used to be one 404 for every failure, on the reasoning that naming the cause helps
// somebody guessing tokens. That holds for a token that resolves to nothing and fails for one that
// resolves: reaching this branch with a matching token proves the caller was given it, so the only
// person it can inform is the named recipient. Telling them "invalid" when the truth is "withdrawn"
// sends them to the jeweller convinced her software is broken.
//
// Nothing else can put them here. There is no expiry on a shared document and never has been.
function Withdrawn() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f7f9', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 440, padding: 28, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, textAlign: 'center' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 8px', color: '#111827' }}>This link was withdrawn</h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>The business that sent you this document has since withdrawn the link. Please contact them if you still need a copy.</p>
      </div>
    </div>
  )
}

export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token
  const share = await resolveShare(token)
  if (!share) {
    // The second lookup runs ONLY when the first failed, so the ordinary case still costs one query.
    if (await shareLinkRevoked(token)) return <Withdrawn />
    notFound()
  }

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
