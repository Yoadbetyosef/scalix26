import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { customerFacing, sendEmail } from '@/lib/email/send'
import { generateApprovalToken, hashToken, looksLikeToken } from './approval-token'
import { loadDocContext, orderDocNumber, type OrderDocType } from './documents'
import { getOrder } from './store'

// Sharing a document with the customer.
//
// ── A SHARE IS NOT AN APPROVAL ──────────────────────────────────────────────────────────────────────
//
// order_approval_requests already has tokens, hashing, revocation and expiry, and reusing it was
// tempting. It was the wrong home: an approval request means "please decide", it moves the order's
// stage, and it is answered. A shared estimate asks for nothing and must never move a stage. Folding
// them together would leave every future reader asking which rows are decisions and which are
// documents.
//
// The token MACHINERY is reused — same generator, same SHA-256 storage, same constant-time compare.
// Only the table is separate.

export interface ShareResult { ok: boolean; error?: string; url?: string }

/** Public link for a raw token. The raw value exists here and in the email, and nowhere else. */
const shareUrl = (baseUrl: string, token: string) => `${baseUrl.replace(/\/$/, '')}/e/${token}`

/**
 * Create a share link for a document and email it to the customer.
 *
 * Branded as the tenant with replies routed to them — the same shape createAndSendApproval uses, and
 * through the same customerFacing() helper that THROWS rather than falling back to our name.
 */
export async function shareDocument(
  orderId: string,
  docType: OrderDocType,
  input: { recipientName?: string | null; recipientEmail: string; message?: string | null },
  baseUrl: string,
): Promise<ShareResult> {
  const c = await requireActiveBusinessContext()
  if (!c) return { ok: false, error: 'Not signed in' }

  const order = await getOrder(orderId)
  if (!order || order.tenantId !== c.tenantId) return { ok: false, error: 'Order not found' }

  const { business } = await loadDocContext(c.tenantId)
  const businessName = business.businessName || ''
  if (!businessName) {
    // customerFacing() would throw on this anyway; failing here says WHY, which is fixable.
    return { ok: false, error: 'Add your business name in settings before sending — it is the sender the customer sees.' }
  }

  const { token, hash } = generateApprovalToken()
  const db = createAdminClient()

  const { error: insErr } = await db.from('order_document_shares').insert({
    tenant_id: c.tenantId,
    order_id: orderId,
    doc_type: docType,
    token_hash: hash,
    recipient_name: input.recipientName ?? null,
    recipient_email: input.recipientEmail,
    created_by: c.actorUserId ?? null,
  })
  if (insErr) {
    // The most likely cause by far is the migration not having been run. Say so, rather than
    // surfacing a PostgREST code the person reading it cannot act on.
    return { ok: false, error: `Could not create the link. If this is a new install, run add_orders_6_estimates_tax_templates.sql. (${insErr.message})` }
  }

  const url = shareUrl(baseUrl, token)
  const label = docType.charAt(0).toUpperCase() + docType.slice(1)
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto">
    <p>Hi${input.recipientName ? ` ${input.recipientName}` : ''},</p>
    <p>Here is your ${docType} <strong>${orderDocNumber(docType, order.orderNumber)}</strong> from ${businessName}.</p>
    ${input.message ? `<p>${input.message}</p>` : ''}
    <p><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">View ${label}</a></p>
    <p style="color:#666;font-size:13px">Or open: ${url}</p>
  </div>`

  const sent = await sendEmail(
    input.recipientEmail,
    `${label} ${orderDocNumber(docType, order.orderNumber)} from ${businessName}`,
    html,
    customerFacing(businessName, { tenantId: c.tenantId, replyTo: business.email ?? undefined }),
  ).catch((e) => ({ success: false as const, error: (e as Error).message }))

  if (!sent.success) {
    // The row stays. The link is valid and can be copied by hand — losing it because the mail server
    // hiccupped would be worse than an unsent email the owner can retry.
    return { ok: false, error: sent.error || 'The link was created but the email could not be sent.', url }
  }

  await db.from('order_document_shares').update({ sent_at: new Date().toISOString() })
    .eq('token_hash', hash).eq('tenant_id', c.tenantId)

  return { ok: true, url }
}

export interface SharedDocument { orderId: string; tenantId: string; docType: OrderDocType }

/**
 * Resolve a raw token to the document it opens, or null.
 *
 * Null covers every failure — malformed, unknown, revoked, expired — on purpose. Telling an anonymous
 * caller WHICH of those it was is free information for someone guessing tokens.
 */
export async function resolveShare(rawToken: string): Promise<SharedDocument | null> {
  if (!looksLikeToken(rawToken)) return null
  try {
    const { data, error } = await createAdminClient()
      .from('order_document_shares')
      .select('order_id, tenant_id, doc_type, revoked_at, expires_at')
      .eq('token_hash', hashToken(rawToken))
      .maybeSingle()
    if (error || !data) return null
    if (data.revoked_at) return null
    if (data.expires_at && new Date(data.expires_at as string) < new Date()) return null
    return {
      orderId: data.order_id as string,
      tenantId: data.tenant_id as string,
      docType: data.doc_type as OrderDocType,
    }
  } catch {
    return null
  }
}
