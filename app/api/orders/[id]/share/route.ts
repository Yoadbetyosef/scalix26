import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requestBaseUrl } from '@/lib/request-url'
import { isOrderDocType } from '@/lib/orders/documents'
import { shareDocument } from '@/lib/orders/shares'

// POST /api/orders/[id]/share — create a public link for a document and email it to the customer.
//
// The base URL comes from the REQUEST, not from an environment variable, so the link a tenant sends
// points at the domain they are actually using. The same reasoning as the OAuth redirect URIs.

const schema = z.object({
  docType: z.string().refine(isOrderDocType, 'Unknown document type'),
  recipientEmail: z.string().email(),
  recipientName: z.string().max(200).nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
}).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  }
  const { docType, ...input } = parsed.data
  const r = await shareDocument((await params).id, docType, input, requestBaseUrl(req))
  if (!r.ok) return NextResponse.json({ error: r.error, url: r.url }, { status: 400 })
  return NextResponse.json({ ok: true, url: r.url })
}
