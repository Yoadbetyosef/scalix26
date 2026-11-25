import { notFound } from 'next/navigation'
import { readPublicQuote } from '@/lib/core/quotes'
import { QuotePaper } from '@/components/quotes/quote-paper'
import { AcceptQuote } from '@/components/quotes/accept'

export const dynamic = 'force-dynamic'

// PUBLIC — the customer's copy of a quote, by the token in the link they were sent. No session.
// The tab is the business's and only the business's (see app/q/[token]/page.tsx for why).
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  try {
    const q = await readPublicQuote((await params).token)
    return q ? { title: `${q.business.name ?? ''} · Quote ${q.number}`.trim(), robots: { index: false, follow: false } } : { title: '', robots: { index: false, follow: false } }
  } catch { return { title: '' } }
}

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const q = await readPublicQuote(token)
  if (!q) notFound()
  return (
    <main className="min-h-screen bg-white">
      <style>{'@page { size: letter; margin: 0.5in; }'}</style>
      <QuotePaper q={q}>
        <AcceptQuote token={q.token} state={q.state} business={q.business.name || 'We'} />
      </QuotePaper>
    </main>
  )
}
