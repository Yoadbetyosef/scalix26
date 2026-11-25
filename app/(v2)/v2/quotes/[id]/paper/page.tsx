import { notFound } from 'next/navigation'
import { readQuotePaper } from '@/lib/core/quotes'
import { QuotePaper } from '@/components/quotes/quote-paper'
import { AcceptQuote } from '@/components/quotes/accept'
import { listPageContext } from '../../../list-page'

export const dynamic = 'force-dynamic'

// THE OWNER'S PREVIEW — the customer's paper, by id inside the owner's own tenant, sent or not.
// "What will they see?" is asked before sending. The Accept button is shown but inert on a draft.
export default async function QuotePaperPreview({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await listPageContext('invoices')
  const q = await readQuotePaper(tenantId, (await params).id)
  if (!q) notFound()
  return (
    <div className="v2-page" style={{ overflowY: 'auto', background: '#fff' }}>
      <QuotePaper q={q}>
        <AcceptQuote token={q.token} state={q.state === 'waiting' || q.state === 'expired' ? 'draft' : q.state} business={q.business.name || 'We'} />
      </QuotePaper>
    </div>
  )
}
