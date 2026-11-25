import { notFound } from 'next/navigation'
import { readQuotePaper } from '@/lib/core/quotes'
import { QuotePaper } from '@/components/quotes/quote-paper'
import { AcceptQuote } from '@/components/quotes/accept'
import { listPageContext } from '@/app/(v2)/v2/list-page'

export const dynamic = 'force-dynamic'

// THE OWNER'S PREVIEW — the customer's paper, by id inside the owner's own tenant, sent or not.
// Outside /v2 on purpose: the paper is the customer's page and takes the same stylesheet theirs does
// (/quote/<token>), not the app's. The /quote/ prefix is public in the middleware, so THIS PAGE is
// the lock: listPageContext sends anyone without a session to sign in, and the read is by tenant.
// "What will they see?" is asked before sending. The Accept button is shown but inert on a draft.
export default async function QuotePaperPreview({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await listPageContext('invoices')
  const q = await readQuotePaper(tenantId, (await params).id)
  if (!q) notFound()
  return (
    <main className="min-h-screen bg-white">
      <style>{'@page { size: letter; margin: 0.5in; }'}</style>
      <QuotePaper q={q}>
        <AcceptQuote token={q.token} state={q.state === 'waiting' || q.state === 'expired' ? 'draft' : q.state} business={q.business.name || 'We'} />
      </QuotePaper>
    </main>
  )
}
