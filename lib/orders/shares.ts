import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { customerFacing, sendEmail } from '@/lib/email/send'
import { generateApprovalToken, hashToken, looksLikeToken } from './approval-token'
import { loadDocContext, orderDocNumber, type OrderDocType } from './documents'
import { getOrder, addEvent } from './store'
import { letterheadStyleFor, resolveLetterhead } from '@/lib/documents/letterhead-resolve'
import { writeDocumentSnapshot } from './document-snapshot'
import type { Order } from './types'

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
 * WHO THIS DOCUMENT IS FROM — the business the letterhead names, not necessarily the tenant.
 *
 * TG is one tenant and two companies. An order printed on the T.G. Designs letterhead must be
 * emailed as T.G. Designs, with replies going to that side's address: the email that said "your
 * estimate from TG jewellers" above a document headed T.G. DESIGNS was the two businesses on one
 * page again, in the inbox this time. Resolved through the same function the document itself uses,
 * so the sender in the email and the sender on the paper cannot disagree.
 */
export async function documentSender(tenantId: string, order: Pick<Order, 'letterheadStyle'>): Promise<{ businessName: string; replyTo: string | null }> {
  const { branding, business } = await loadDocContext(tenantId)
  const lh = branding.letterhead
  const resolved = resolveLetterhead(lh, letterheadStyleFor(order.letterheadStyle, lh), business, branding.accent)
  const name = (resolved.enabled && resolved.businessName) || business.businessName || ''
  const replyTo = (resolved.enabled && resolved.email) || business.email || null
  return { businessName: name, replyTo }
}

/**
 * Mint a link for a document WITHOUT emailing it — for the owner to paste into her own message, a
 * text, a WhatsApp. This is the fix for the customer who was "asked to log in": the address bar on
 * her own document tab is /orders/[id]/document/…, which is the owner's page behind auth, and it
 * was the only link on screen to copy. The link a customer can open is this one.
 *
 * Recorded like every other link — same table, same revocation — so it appears in Shared links and
 * can be withdrawn.
 */
export async function createShareLink(orderId: string, docType: OrderDocType, baseUrl: string, label?: string | null): Promise<ShareResult> {
  const c = await requireActiveBusinessContext()
  if (!c) return { ok: false, error: 'Not signed in' }
  const order = await getOrder(orderId)
  if (!order || order.tenantId !== c.tenantId) return { ok: false, error: 'Order not found' }

  const { token, hash } = generateApprovalToken()
  const { data: created, error } = await createAdminClient().from('order_document_shares').insert({
    tenant_id: c.tenantId, order_id: orderId, doc_type: docType, token_hash: hash,
    recipient_name: (label ?? '').trim() || null,
    // The column is NOT NULL and means "who this was emailed to"; a copied link was emailed to nobody.
    // The sentinel is a plain word, never an address, so nothing downstream can try to send to it.
    recipient_email: COPIED_LINK,
    sent_at: new Date().toISOString(), created_by: c.actorUserId ?? null,
  }).select('id').single()
  if (error || !created) return { ok: false, error: `Could not create the link. (${error?.message ?? 'no row'})` }
  // The document as it is NOW, frozen under this link — see document-snapshot.ts.
  await writeDocumentSnapshot(c.tenantId, orderId, created.id as string, docType)
  const url = shareUrl(baseUrl, token)
  await addEvent(orderId, 'document_shared', { docType, via: 'link', shareId: created.id })
  return { ok: true, url }
}
/** The recipient_email of a link that was copied rather than emailed. */
export const COPIED_LINK = 'link'

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

  const { businessName, replyTo } = await documentSender(c.tenantId, order)
  if (!businessName) {
    // customerFacing() would throw on this anyway; failing here says WHY, which is fixable.
    return { ok: false, error: 'Add your business name in settings before sending — it is the sender the customer sees.' }
  }

  const { token, hash } = generateApprovalToken()
  const db = createAdminClient()

  const { data: created, error: insErr } = await db.from('order_document_shares').insert({
    tenant_id: c.tenantId,
    order_id: orderId,
    doc_type: docType,
    token_hash: hash,
    recipient_name: input.recipientName ?? null,
    recipient_email: input.recipientEmail,
    created_by: c.actorUserId ?? null,
  }).select('id').single()
  if (insErr || !created) {
    console.error('[orders] share insert failed', insErr?.message)
    return { ok: false, error: 'The link could not be created. Please try again; if it keeps failing, contact support.' }
  }
  // Frozen at the moment it is sent — see document-snapshot.ts.
  await writeDocumentSnapshot(c.tenantId, orderId, created.id as string, docType)

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
    customerFacing(businessName, { tenantId: c.tenantId, replyTo: replyTo ?? undefined }),
  ).catch((e) => ({ success: false as const, error: (e as Error).message }))

  if (!sent.success) {
    // The row stays. The link is valid and can be copied by hand — losing it because the mail server
    // hiccupped would be worse than an unsent email the owner can retry.
    return { ok: false, error: sent.error || 'The link was created but the email could not be sent.', url }
  }

  await db.from('order_document_shares').update({ sent_at: new Date().toISOString() })
    .eq('token_hash', hash).eq('tenant_id', c.tenantId)
  // On the timeline, so "was the estimate ever sent?" is answered from the order rather than from
  // the inbox. The recipient is on the Shared links panel, not here.
  await addEvent(orderId, 'document_shared', { docType, via: 'email', shareId: created.id })

  return { ok: true, url }
}

export interface SharedDocument { orderId: string; tenantId: string; docType: OrderDocType; shareId: string }

/** One live or withdrawn link, for the owner's own list. The raw token is NOT here — it cannot be. */
export interface ShareRow {
  id: string; docType: OrderDocType; recipientName: string | null; recipientEmail: string
  sentAt: string | null; revokedAt: string | null; createdAt: string
}

const shareRow = (r: Record<string, unknown>): ShareRow => ({
  id: r.id as string, docType: r.doc_type as OrderDocType,
  recipientName: (r.recipient_name as string) ?? null, recipientEmail: r.recipient_email as string,
  sentAt: (r.sent_at as string) ?? null, revokedAt: (r.revoked_at as string) ?? null,
  createdAt: r.created_at as string,
})

/**
 * Every link ever minted for this order, newest first.
 *
 * ── THE OWNER COULD NOT SEE THESE, WHICH IS WHY SHE COULD NOT KILL THEM ─────────────────────────
 *
 * `revoked_at` has been on this table since it was created and no code in the repository ever wrote
 * it: no route, no action, no button. So a link, once emailed, was permanent and invisible — the one
 * thing a shared document must never be. Meanwhile the APPROVAL link, which should have been
 * permanent, was expiring on its own. The two were exactly the wrong way round.
 */
export async function listShares(orderId: string): Promise<ShareRow[]> {
  const c = await requireActiveBusinessContext()
  if (!c) return []
  const { data } = await createAdminClient()
    .from('order_document_shares')
    .select('id, doc_type, recipient_name, recipient_email, sent_at, revoked_at, created_at')
    .eq('tenant_id', c.tenantId).eq('order_id', orderId)
    .order('created_at', { ascending: false })
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(shareRow)
}

/**
 * Withdraw a link. The ONLY thing that ends one.
 *
 * Scoped by tenant on the write itself rather than by a read-then-write, so a share id belonging to
 * another tenant updates nothing instead of being checked and then trusted. `revoked_at` is set once
 * and never cleared: un-revoking would mean a link the owner believed she had killed coming back,
 * and re-sending mints a fresh token, which is the honest way to change her mind.
 */
export async function revokeShare(shareId: string): Promise<{ ok: boolean; error?: string }> {
  const c = await requireActiveBusinessContext()
  if (!c) return { ok: false, error: 'Not signed in' }
  const db = createAdminClient()
  const { data, error } = await db.from('order_document_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('tenant_id', c.tenantId).eq('id', shareId).is('revoked_at', null)
    .select('id, order_id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: 'That link no longer exists, or was already withdrawn.' }
  await db.from('order_events').insert({
    tenant_id: c.tenantId, order_id: data[0].order_id as string,
    type: 'share_revoked', actor: c.actorUserId, payload: { shareId },
  })
  return { ok: true }
}

/**
 * Why a share token that RESOLVES is nonetheless not readable — see approvals.deadLinkReason for the
 * full reasoning. In one line: a caller holding a token that matches a row has proved they were
 * given it, so naming the cause leaks nothing an attacker could not already have; a token that
 * matches nothing gets silence.
 *
 * 'revoked' is the only value this can return. There is no expiry to report because a shared
 * document has never had one, and now neither does an approval.
 */
export async function shareLinkRevoked(rawToken: string): Promise<boolean> {
  if (!looksLikeToken(rawToken)) return false
  try {
    const { data } = await createAdminClient()
      .from('order_document_shares').select('revoked_at')
      .eq('token_hash', hashToken(rawToken)).maybeSingle()
    return !!data?.revoked_at
  } catch {
    return false
  }
}

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
      .select('id, order_id, tenant_id, doc_type, revoked_at')
      .eq('token_hash', hashToken(rawToken))
      .maybeSingle()
    if (error || !data) return null
    // REVOCATION IS THE ONLY THING THAT ENDS A LINK.
    //
    // `expires_at` is no longer consulted. It has never been written — every row in production holds
    // null — so this changes nothing today; it is removed because reading it left a column sitting
    // there that a future migration could give a default to, and a default on that column would kill
    // every shared document silently and at once. The same idea, on the approval side, is what put
    // two already-dead links in a customer's inbox. There is no expiry here and there is not going
    // to be one.
    if (data.revoked_at) return null
    return {
      orderId: data.order_id as string,
      tenantId: data.tenant_id as string,
      docType: data.doc_type as OrderDocType,
      shareId: data.id as string,
    }
  } catch {
    return null
  }
}
