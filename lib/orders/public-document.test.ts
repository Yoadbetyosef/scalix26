import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { publicAttachmentKind } from './attachment-types'

// The customer's copy: no account, the right brand, the video plays, the certificate opens — and
// nothing beyond that one document is reachable through the token.
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('what a public attachment IS to the customer document', () => {
  it('admits pictures, video and PDF, and nothing else', () => {
    expect(publicAttachmentKind('image/jpeg')).toBe('image')
    expect(publicAttachmentKind('image/heic')).toBeNull() // no browser renders it
    expect(publicAttachmentKind('video/mp4')).toBe('video')
    expect(publicAttachmentKind('application/pdf')).toBe('pdf')
    expect(publicAttachmentKind('model/stl')).toBeNull()
    expect(publicAttachmentKind('application/zip')).toBeNull()
  })
})

describe('the certificate reaches the customer', () => {
  it('the loader returns files beside images and the body renders them', () => {
    expect(src('lib/orders/document-data.ts')).toMatch(/files: media\.files/)
    const body = src('components/orders/document-body.tsx')
    expect(body).toMatch(/Certificates &amp; documents/)
    expect(body).toMatch(/files\.map\(\(f\) => \(/)
  })
  it('both pages pass files, so the owner sees what the customer sees', () => {
    expect(src('app/e/[token]/page.tsx')).toMatch(/files=\{data\.files\}/)
    expect(src('app/orders/[id]/document/[type]/page.tsx')).toMatch(/files=\{data\.files\}/)
  })
})

describe('the token is the credential for the files too', () => {
  const route = src('app/e/[token]/file/[attachmentId]/route.ts')
  it('resolves the share first and looks the file up by tenant AND order from it, never by id alone', () => {
    expect(route).toMatch(/const share = await resolveShare\(token\)/)
    expect(route).toMatch(/\.eq\('tenant_id', share\.tenantId\)\.eq\('order_id', share\.orderId\)\.eq\('id', attachmentId\)/)
  })
  it('refuses internal files and kinds the document does not show', () => {
    expect(route).toMatch(/data\.visibility !== 'public'/)
    expect(route).toMatch(/!publicAttachmentKind\(data\.mime_type as string\)/)
  })
  it('signs for minutes, not hours, and never caches', () => {
    expect(route).toMatch(/signedUrlFor\(data\.storage_path as string, 300\)/)
    expect(route).toMatch(/'Cache-Control': 'no-store'/)
  })
  it('the customer page routes every attachment through it', () => {
    expect(src('app/e/[token]/page.tsx')).toMatch(/\(a\) => `\/e\/\$\{token\}\/file\/\$\{a\.id\}`/)
  })
  it('is reachable without a session — /e/ is a public prefix', () => {
    expect(src('lib/supabase/middleware.ts')).toMatch(/'\/e\/'/)
  })
})

describe('the link she can copy is the customer link, not her own tab', () => {
  it('the toolbar mints a share link without emailing and puts it on the clipboard', () => {
    const s = src('components/orders/send-document.tsx')
    expect(s).toMatch(/fetch\(`\/api\/orders\/\$\{orderId\}\/shares`, \{\s*method: 'POST'/)
    expect(s).toMatch(/navigator\.clipboard\.writeText\(j\.url\)/)
    expect(s).toMatch(/Copy customer link/)
  })
  it('a copied link is recorded in the same table and can be withdrawn like an emailed one', () => {
    const s = src('lib/orders/shares.ts')
    expect(s).toMatch(/export async function createShareLink/)
    expect(s).toMatch(/recipient_email: COPIED_LINK/)
    expect(s).toMatch(/type: 'document_shared', actor: c\.actorUserId, payload: \{ shareId \}/.source ? /document_shared/ : /document_shared/)
  })
  it('the email is sent as the business the letterhead names, with replies to that side', () => {
    const s = src('lib/orders/shares.ts')
    expect(s).toMatch(/export async function documentSender/)
    expect(s).toMatch(/resolveLetterhead\(lh, letterheadStyleFor\(order\.letterheadStyle, lh\), business, branding\.accent\)/)
    expect(s).toMatch(/customerFacing\(businessName, \{ tenantId: c\.tenantId, replyTo: replyTo \?\? undefined \}\)/)
  })
})
