import { NextRequest, NextResponse } from 'next/server'
import { attachmentForToken } from '@/lib/orders/approvals'
import { signedUrlFor } from '@/lib/orders/attachments'

// PUBLIC file proxy for the approval page. The recipient has only a token, and this hands back the file
// bytes without ever revealing where it lives: a Supabase signed URL embeds the object path, which is
// `<tenant_id>/<order_id>/<uuid>`, so linking to one directly would leak both internal ids to an external
// factory on every image the page renders.
//
// attachmentForToken re-checks the token, the request's status, the link between request and attachment,
// and public visibility. Anything short of all four is an indistinguishable 404.

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string; aid: string }> }) {
  const { token, aid } = await params
  const att = await attachmentForToken(token, aid)
  if (!att) return new NextResponse('Not found', { status: 404 })

  const signed = await signedUrlFor(att.storagePath, 60)
  if (!signed) return new NextResponse('Not found', { status: 404 })

  // Fetch server-side and stream the bytes on, so the signed URL never reaches the browser.
  const upstream = await fetch(signed)
  if (!upstream.ok || !upstream.body) return new NextResponse('Not found', { status: 404 })

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': att.mimeType || 'application/octet-stream',
      // inline so images render in the page; the filename is preserved for a download.
      'Content-Disposition': `inline; filename="${att.fileName.replace(/["\\\r\n]/g, '')}"`,
      // Private: this URL is only meaningful to the token holder, and must not sit in a shared cache.
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
