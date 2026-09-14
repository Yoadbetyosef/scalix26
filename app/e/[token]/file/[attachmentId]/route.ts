import { NextResponse } from 'next/server'
import { resolveShare } from '@/lib/orders/shares'
import { signedUrlFor } from '@/lib/orders/attachments'
import { publicAttachmentKind } from '@/lib/orders/attachment-types'
import { createAdminClient } from '@/lib/supabase/server'

// GET /e/[token]/file/[attachmentId] — one public attachment of a shared document, re-signed at
// click time.
//
// ── WHY A ROUTE AND NOT A SIGNED URL ON THE PAGE ────────────────────────────────────────────────
//
// The page is rendered once, with signed storage URLs that last thirty minutes. A customer opens the
// estimate, reads it, leaves it open, and comes back after lunch to open the certificate — and the
// link is dead, with no explanation. This route makes the SHARE TOKEN the credential for the file
// as well as the page: it resolves the token exactly as the page does, checks the attachment is on
// THAT order, is public, and is a kind the document shows, and only then mints a five-minute URL and
// redirects to it. A revoked share stops the files with the page.
//
// The token proves nothing about any other order: the attachment is looked up by (tenant, order, id)
// from the resolved share, never by id alone.
export const dynamic = 'force-dynamic'

// What a person sees if they land here without a valid file behind it. A sentence, not a code.
const gone = () => new NextResponse(
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>File not available</title>
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f7f9;font-family:system-ui,sans-serif;padding:24px">
<div style="max-width:440px;padding:28px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;text-align:center">
<h1 style="font-size:18px;margin:0 0 8px;color:#111827">This file is not available</h1>
<p style="font-size:14px;color:#6b7280;margin:0">It may have been replaced, or the document link it belongs to may have been withdrawn. Please go back to the document, or ask the business that sent it to resend the file.</p>
</div></div>`,
  { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
)

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; attachmentId: string }> }) {
  const { token, attachmentId } = await params
  const share = await resolveShare(token)
  if (!share) return gone()
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return gone()

  const { data } = await createAdminClient()
    .from('order_attachments').select('storage_path, mime_type, visibility')
    .eq('tenant_id', share.tenantId).eq('order_id', share.orderId).eq('id', attachmentId)
    .maybeSingle()
  if (!data || data.visibility !== 'public' || !publicAttachmentKind(data.mime_type as string)) return gone()
  const url = await signedUrlFor(data.storage_path as string, 300)
  if (!url) return gone()
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
}
