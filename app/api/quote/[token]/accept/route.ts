import { NextRequest, NextResponse } from 'next/server'
import { acceptQuote } from '@/lib/core/quotes'

// POST /api/quote/<token>/accept — the customer accepting their quote. Public: the unguessable token
// in the link they were sent is the whole credential, exactly as it is for reading the quote.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await acceptQuote(token)
  if (r.ok) return NextResponse.json({ ok: true })
  return NextResponse.json({ ok: false, error: r.error === 'expired' ? 'This quote has expired. Please ask for an updated one.' : 'This quote could not be found.' }, { status: r.error === 'expired' ? 409 : 404 })
}
