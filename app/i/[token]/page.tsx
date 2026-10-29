import { notFound } from 'next/navigation'
import { readPublicInvoice } from '@/lib/core/invoice-read'
import { PrintButton } from '@/components/studio/print-button'
import { InvoicePaper } from '@/components/invoices/invoice-paper'

// THE CUSTOMER'S COPY OF AN INVOICE.
//
// No session. The token in the URL is the sole credential — the same arrangement /d/ uses for studio
// documents and /e/ for order documents. It is a THIRD path deliberately: /d/ resolves against
// studio_documents, four of which have been sent to a real customer, and a token URL given to a
// customer is a promise. The cheapest way to keep it is not to go near it.
//
// ── PAYMENT INSTRUCTIONS COME FIRST ─────────────────────────────────────────────────────────────
//
// Above the lines, not below them. On the owner's screen the block is reference material; on this one
// it is the INSTRUCTION, and an instruction goes before the detail it applies to. It renders the
// SNAPSHOT taken at issue, so somebody reopening a six-month-old link sees where the money was meant
// to go then — not wherever the business banks today.
//
// It is also the answer to the placeholder /d/ still shows on a studio invoice: "Payment instructions
// to be provided by the studio."

export const dynamic = 'force-dynamic'

// The page title is the TENANT'S, and only the tenant's. Chrome prints document.title at the top of
// every printed page, so inheriting the root layout's platform name would put our brand across the
// top of every invoice a customer prints. A customer reading this is not our customer.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  try {
    const inv = await readPublicInvoice((await params).token)
    if (!inv) return { title: '' }
    return {
      title: [inv.business.name, `Invoice ${inv.number}`].filter(Boolean).join(' · '),
      robots: { index: false, follow: false },
    }
  } catch {
    return { title: '' }
  }
}


export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const inv = await readPublicInvoice(token)
  // A draft answers the same way a bad token does — see readPublicInvoice.
  if (!inv) notFound()

  return (
    <main className="min-h-screen bg-white">
      <InvoicePaper inv={inv}>
        <div className="mt-10 print:hidden"><PrintButton /></div>
      </InvoicePaper>
    </main>
  )
}
