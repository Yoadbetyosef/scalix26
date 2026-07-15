import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { sendEmail } from '@/lib/email/send'
import { generateApprovalToken, hashToken, looksLikeToken } from './approval-token'
import { signedUrlFor, ALLOWED_MIME, MAX_ATTACHMENT_BYTES, ORDER_BUCKET } from './attachments'
import { canSendForApproval, canSendToProduction, stageAfterSend, stageAfterResponse, respondableStage, type ApprovalType, type ApprovalDecision, type OrderStage } from './stages'
import { approvalEmailHtml, deliveryRequestEmailHtml } from './approval-email'
import type { PublicOrderView } from './types'

// External approval primitive. Tatiana-side ops go through the RLS client; the PUBLIC token route uses the
// service role + token-hash validation (no session). Raw tokens are never stored or logged. Sending advances
// the order stage ONLY after the email succeeds. Resending revokes the prior actionable token (versioning).

const DEFAULT_EXPIRY_DAYS = 14

export interface ApprovalRequestRow {
  id: string; orderId: string; approvalType: ApprovalType; recipientName: string | null; recipientEmail: string
  status: string; version: number; subject: string | null; message: string | null; expiresAt: string | null
  sentAt: string | null; openedAt: string | null; respondedAt: string | null; responseComment: string | null
  estimatedCompletionDate: string | null; createdAt: string
}
const reqRow = (r: Record<string, unknown>): ApprovalRequestRow => ({ id: r.id as string, orderId: r.order_id as string, approvalType: r.approval_type as ApprovalType, recipientName: (r.recipient_name as string) ?? null, recipientEmail: r.recipient_email as string, status: r.status as string, version: Number(r.version ?? 1), subject: (r.subject as string) ?? null, message: (r.message as string) ?? null, expiresAt: (r.expires_at as string) ?? null, sentAt: (r.sent_at as string) ?? null, openedAt: (r.opened_at as string) ?? null, respondedAt: (r.responded_at as string) ?? null, responseComment: (r.response_comment as string) ?? null, estimatedCompletionDate: (r.estimated_completion_date as string) ?? null, createdAt: r.created_at as string })

export async function listApprovalsForOrder(orderId: string): Promise<ApprovalRequestRow[]> {
  const c = await requireActiveBusinessContext(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('order_approval_requests').select('*').eq('tenant_id', c.tenantId).eq('order_id', orderId).order('created_at', { ascending: false })
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(reqRow)
}

export interface SendApprovalInput { approvalType: ApprovalType; recipientName?: string | null; recipientEmail: string; subject?: string | null; message?: string | null; deadline?: string | null; attachmentIds?: string[]; sendCopyToSelf?: boolean; internalNote?: string | null }

export async function createAndSendApproval(orderId: string, input: SendApprovalInput, baseUrl: string): Promise<{ ok: boolean; error?: string; requestId?: string }> {
  const c = await requireActiveBusinessContext(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()

  const { data: order } = await sb.from('orders').select('*').eq('tenant_id', c.tenantId).eq('id', orderId).maybeSingle()
  if (!order) return { ok: false, error: 'not found' }
  const stage = order.stage as OrderStage
  // Required info + valid transition.
  if (!input.recipientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.recipientEmail)) return { ok: false, error: 'A valid recipient email is required.' }
  if (!canSendForApproval(stage, input.approvalType)) return { ok: false, error: `Cannot send a ${input.approvalType} approval while the order is "${stage}".` }
  const { count: lineCount } = await sb.from('order_line_items').select('id', { count: 'exact', head: true }).eq('order_id', orderId)
  if (!lineCount) return { ok: false, error: 'Add at least one line item before sending for approval.' }

  // Version + revoke any prior actionable request of this type (old tokens become non-actionable).
  const { data: priors } = await sb.from('order_approval_requests').select('id, version, status').eq('tenant_id', c.tenantId).eq('order_id', orderId).eq('approval_type', input.approvalType)
  const version = (priors ?? []).reduce((m, r) => Math.max(m, Number(r.version ?? 1)), 0) + 1
  const actionable = (priors ?? []).filter((r) => ['draft', 'sent', 'opened'].includes(r.status as string))
  if (actionable.length) await sb.from('order_approval_requests').update({ status: 'revoked', revoked_at: new Date().toISOString() }).in('id', actionable.map((r) => r.id))

  const { token, hash } = generateApprovalToken()
  const expiresAt = input.deadline ? new Date(input.deadline + 'T23:59:59Z').toISOString() : new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000).toISOString()
  const { data: created, error: insErr } = await sb.from('order_approval_requests').insert({
    tenant_id: c.tenantId, order_id: orderId, approval_type: input.approvalType, recipient_name: input.recipientName ?? null, recipient_email: input.recipientEmail,
    token_hash: hash, status: 'draft', version, subject: input.subject ?? null, message: input.message ?? null, internal_note: input.internalNote ?? null,
    expires_at: expiresAt, created_by: c.actorUserId,
  }).select('*').single()
  if (insErr || !created) return { ok: false, error: insErr?.message ?? 'Could not create the request.' }
  const requestId = created.id as string

  // Link ONLY public-visibility attachments that were selected.
  const wanted = input.attachmentIds ?? []
  if (wanted.length) {
    const { data: allowed } = await sb.from('order_attachments').select('id').eq('tenant_id', c.tenantId).eq('order_id', orderId).eq('visibility', 'public').in('id', wanted)
    const ids = (allowed ?? []).map((a) => a.id as string)
    if (ids.length) await sb.from('order_approval_attachments').insert(ids.map((attachment_id, i) => ({ tenant_id: c.tenantId, approval_request_id: requestId, attachment_id, display_order: i })))
  }

  // Business branding for the email.
  const { data: tenant } = await createAdminClient().from('tenants').select('business_name, email').eq('id', c.tenantId).maybeSingle()
  const businessName = (tenant?.business_name as string) || 'Our team'
  const link = `${baseUrl.replace(/\/$/, '')}/approval/${token}` // raw token only in the link, never persisted/logged

  // Send FIRST; only advance the stage if the email actually succeeds (sendEmail RETURNS {success}, not throws).
  const html = approvalEmailHtml({ businessName, orderNumber: order.order_number as string, approvalType: input.approvalType, message: input.message ?? null, deadline: input.deadline ?? expiresAt.slice(0, 10), link, supportEmail: (tenant?.email as string) ?? null })
  const sendResult = await sendEmail(input.recipientEmail, input.subject || `Approval requested — order ${order.order_number}`, html, { tenantId: c.tenantId, fromName: businessName, replyTo: (tenant?.email as string) ?? undefined }).catch((e) => ({ success: false as const, error: (e as Error).message }))
  if (!sendResult.success) {
    // Email failed → keep the request as draft, DO NOT advance the order stage.
    return { ok: false, error: `Email failed to send${'error' in sendResult && sendResult.error ? ` (${sendResult.error})` : ''}; the order stage was not changed.`, requestId }
  }
  if (input.sendCopyToSelf && tenant?.email) await sendEmail(tenant.email as string, `[Copy] Approval sent — order ${order.order_number}`, html, { tenantId: c.tenantId, fromName: businessName }).catch(() => {})

  const now = new Date().toISOString()
  await sb.from('order_approval_requests').update({ status: 'sent', sent_at: now, updated_at: now }).eq('id', requestId)
  await sb.from('orders').update({ stage: stageAfterSend(input.approvalType), updated_at: now }).eq('tenant_id', c.tenantId).eq('id', orderId)
  await sb.from('order_events').insert({ tenant_id: c.tenantId, order_id: orderId, type: 'approval_sent', actor: c.actorUserId, payload: { approvalType: input.approvalType, version, recipientEmail: input.recipientEmail } })
  return { ok: true, requestId }
}

export async function revokeApproval(requestId: string): Promise<boolean> {
  const c = await requireActiveBusinessContext(); if (!c) return false
  const sb = await createClient()
  const { data } = await sb.from('order_approval_requests').select('order_id, status').eq('tenant_id', c.tenantId).eq('id', requestId).maybeSingle()
  if (!data || ['revoked', 'expired'].includes(data.status as string)) return false
  await sb.from('order_approval_requests').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('id', requestId)
  await sb.from('order_events').insert({ tenant_id: c.tenantId, order_id: data.order_id as string, type: 'approval_revoked', actor: c.actorUserId, payload: { requestId } })
  return true
}

// ── Public (token) side — service role, no session ─────────────────────────────────────────────────────
export interface PublicApprovalView {
  businessName: string; approvalType: ApprovalType; status: string; recipientName: string | null
  deadline: string | null; canRespond: boolean; order: PublicOrderView
  attachments: Array<{ fileName: string; mimeType: string; url: string | null }>
  existingResponse: { comment: string | null; estimatedCompletionDate: string | null } | null
  // Factory-only production hand-off: once the order is in production, the same link lets the factory
  // upload an invoice and mark the item ready. Set only for factory tokens.
  canSubmitDelivery: boolean; deliverySubmitted: boolean
}

async function findByToken(rawToken: string) {
  if (!looksLikeToken(rawToken)) return null
  const sb = createAdminClient()
  const { data } = await sb.from('order_approval_requests').select('*').eq('token_hash', hashToken(rawToken)).maybeSingle()
  return data ? (data as Record<string, unknown>) : null
}
const isExpired = (r: Record<string, unknown>) => !!r.expires_at && new Date(r.expires_at as string).getTime() < Date.now()

export async function getApprovalByToken(rawToken: string): Promise<PublicApprovalView | null> {
  const r = await findByToken(rawToken)
  if (!r) return null
  const status = r.status as string
  if (status === 'revoked' || status === 'draft') return null
  const sb = createAdminClient()
  // Expired (either already marked, or past its deadline) → mark + show the generic unavailable page.
  if (status === 'expired' || isExpired(r)) {
    if (status !== 'expired') await sb.from('order_approval_requests').update({ status: 'expired' }).eq('id', r.id as string)
    return null
  }

  // Mark opened on first view.
  if (r.status === 'sent') {
    await sb.from('order_approval_requests').update({ status: 'opened', opened_at: new Date().toISOString() }).eq('id', r.id as string)
    await sb.from('order_events').insert({ tenant_id: r.tenant_id, order_id: r.order_id, type: 'approval_opened', actor: r.approval_type as string })
    r.status = 'opened'
  }

  const { data: order } = await sb.from('orders').select('order_number, customer_name, requested_completion_date, public_notes, stage').eq('id', r.order_id as string).maybeSingle()
  const { data: lines } = await sb.from('order_line_items').select('product_name, description, quantity, measurements, color, material, custom_spec').eq('order_id', r.order_id as string).order('display_order')
  const { data: tenant } = await sb.from('tenants').select('business_name').eq('id', r.tenant_id as string).maybeSingle()
  const { data: attRows } = await sb.from('order_approval_attachments').select('attachment_id').eq('approval_request_id', r.id as string).order('display_order')
  const attIds = (attRows ?? []).map((a) => a.attachment_id as string)
  let attachments: PublicApprovalView['attachments'] = []
  if (attIds.length) {
    const { data: atts } = await sb.from('order_attachments').select('file_name, mime_type, storage_path, visibility').in('id', attIds).eq('visibility', 'public')
    attachments = await Promise.all((atts ?? []).map(async (a) => ({ fileName: a.file_name as string, mimeType: a.mime_type as string, url: await signedUrlFor(a.storage_path as string, 600) })))
  }

  const publicOrder: PublicOrderView = {
    orderNumber: (order?.order_number as string) ?? '', customerName: (order?.customer_name as string) ?? null,
    requestedCompletionDate: (order?.requested_completion_date as string) ?? null, publicNotes: (order?.public_notes as string) ?? null,
    lineItems: ((lines as Array<Record<string, unknown>>) ?? []).map((l) => ({ productName: l.product_name as string, description: (l.description as string) ?? null, quantity: Number(l.quantity ?? 1), measurements: (l.measurements as string) ?? null, color: (l.color as string) ?? null, material: (l.material as string) ?? null, customSpec: (l.custom_spec as string) ?? null })),
  }
  const responded = ['approved', 'changes_requested', 'rejected'].includes(r.status as string)
  const orderStage = (order?.stage as OrderStage) ?? 'new'
  const isFactory = (r.approval_type as ApprovalType) === 'factory'
  return {
    businessName: (tenant?.business_name as string) || 'Our team', approvalType: r.approval_type as ApprovalType, status: r.status as string, recipientName: (r.recipient_name as string) ?? null,
    // Can respond (or change a prior response) while not revoked/expired. Reopening the link is allowed.
    deadline: (r.expires_at as string) ?? null, canRespond: !isExpired(r) && !['revoked', 'draft', 'expired'].includes(r.status as string),
    order: publicOrder, attachments,
    existingResponse: responded ? { comment: (r.response_comment as string) ?? null, estimatedCompletionDate: (r.estimated_completion_date as string) ?? null } : null,
    // Same factory link becomes a "ready + invoice" hand-off once the order reaches production.
    canSubmitDelivery: isFactory && orderStage === 'production',
    deliverySubmitted: isFactory && ['ready', 'delivered', 'completed'].includes(orderStage),
  }
}

export async function recordApprovalResponse(rawToken: string, decision: ApprovalDecision, comment: string | null, estCompletionDate: string | null): Promise<{ ok: boolean; error?: string }> {
  const r = await findByToken(rawToken)
  if (!r) return { ok: false, error: 'This approval link is invalid or has expired.' }
  const status = r.status as string
  if (['revoked'].includes(status)) return { ok: false, error: 'This approval link has been revoked.' }
  if (isExpired(r)) return { ok: false, error: 'This approval link has expired.' }
  if ((decision === 'changes_requested' || decision === 'rejected') && !(comment && comment.trim())) return { ok: false, error: 'A comment is required for this response.' }

  const type = r.approval_type as ApprovalType
  const sb = createAdminClient()
  // Must be in the respondable stage OR already at a result of this cycle (allows a decision change), and the
  // request itself must be actionable (sent/opened) or already responded on this cycle.
  const { data: order } = await sb.from('orders').select('stage').eq('id', r.order_id as string).maybeSingle()
  const orderStage = order?.stage as OrderStage | undefined
  const resultStages: OrderStage[] = type === 'factory' ? ['factory_approved', 'factory_changes_requested'] : ['customer_approved', 'customer_changes_requested']
  const cycleOk = orderStage === respondableStage(type) || resultStages.includes(orderStage as OrderStage)
  if (!['sent', 'opened', 'approved', 'changes_requested', 'rejected'].includes(status) || !cycleOk) return { ok: false, error: 'This order is no longer awaiting your response.' }

  const now = new Date().toISOString()
  const newStatus = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'changes_requested'
  await sb.from('order_approval_requests').update({ status: newStatus, responded_at: now, response_comment: comment ?? null, estimated_completion_date: estCompletionDate ?? null, updated_at: now }).eq('id', r.id as string)
  const nextStage = stageAfterResponse(type, decision)
  await sb.from('orders').update({ stage: nextStage, ...(estCompletionDate ? { estimated_completion_date: estCompletionDate } : {}), updated_at: now }).eq('id', r.order_id as string)
  await sb.from('order_events').insert({ tenant_id: r.tenant_id, order_id: r.order_id, type: 'approval_responded', actor: type, payload: { approvalType: type, decision, hasComment: !!comment, changed: ['approved', 'changes_requested', 'rejected'].includes(status) } })

  // Notify Tatiana (tenant email). Best-effort — never blocks the recipient's response.
  try {
    const { data: tenant } = await sb.from('tenants').select('email, business_name').eq('id', r.tenant_id as string).maybeSingle()
    const { data: ord } = await sb.from('orders').select('order_number').eq('id', r.order_id as string).maybeSingle()
    if (tenant?.email) await sendEmail(tenant.email as string, `${type === 'factory' ? 'Factory' : 'Customer'} responded — order ${ord?.order_number}`, `<p>The ${type} responded to order <strong>${ord?.order_number}</strong>: <strong>${decision.replace('_', ' ')}</strong>.</p>${comment ? `<p>Comment: ${comment.replace(/[<>]/g, '')}</p>` : ''}${estCompletionDate ? `<p>Estimated completion: ${estCompletionDate}</p>` : ''}`, { tenantId: r.tenant_id as string, fromName: (tenant?.business_name as string) || undefined })
  } catch { /* ignore notification failure */ }
  return { ok: true }
}

// PUBLIC factory hand-off: the factory (no account — the token is the only credential) uploads an invoice
// and marks the item ready once the order is in production. Moves production → ready, stores the invoice as
// an INTERNAL attachment (never shown on the approval page), logs the timeline, and notifies the tenant.
export async function submitFactoryDelivery(rawToken: string, file: File): Promise<{ ok: boolean; error?: string }> {
  const r = await findByToken(rawToken)
  if (!r) return { ok: false, error: 'This link is invalid or has expired.' }
  if (['revoked', 'draft'].includes(r.status as string) || isExpired(r)) return { ok: false, error: 'This link is no longer available.' }
  if ((r.approval_type as ApprovalType) !== 'factory') return { ok: false, error: 'This action is not available.' }
  const ext = ALLOWED_MIME[file.type]
  if (!ext) return { ok: false, error: `Unsupported file type (${file.type || 'unknown'}). Use PNG, JPG, WEBP, GIF or PDF.` }
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'File too large (max 20MB).' }

  const sb = createAdminClient()
  const tenantId = r.tenant_id as string, orderId = r.order_id as string
  const { data: order } = await sb.from('orders').select('stage, order_number').eq('id', orderId).maybeSingle()
  if (!order) return { ok: false, error: 'not found' }
  if ((order.stage as string) !== 'production') return { ok: false, error: 'This order is not currently awaiting a ready confirmation.' }

  // Store the invoice in the private bucket (same path convention as tenant-side uploads).
  const path = `${tenantId}/${orderId}/${crypto.randomUUID()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  const up = await sb.storage.from(ORDER_BUCKET).upload(path, buf, { contentType: file.type, upsert: false })
  if (up.error) return { ok: false, error: up.error.message }
  const { error: insErr } = await sb.from('order_attachments').insert({ tenant_id: tenantId, order_id: orderId, storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, file_size: file.size, uploaded_by: 'factory', visibility: 'internal' })
  if (insErr) { await sb.storage.from(ORDER_BUCKET).remove([path]); return { ok: false, error: insErr.message } }

  const now = new Date().toISOString()
  await sb.from('orders').update({ stage: 'ready', updated_at: now }).eq('id', orderId)
  await sb.from('order_events').insert({ tenant_id: tenantId, order_id: orderId, type: 'factory_ready', actor: 'factory', payload: { fileName: file.name.slice(0, 200) } })

  // Notify the tenant. Best-effort — never blocks the factory's submission.
  try {
    const { data: tenant } = await sb.from('tenants').select('email, business_name').eq('id', tenantId).maybeSingle()
    if (tenant?.email) await sendEmail(tenant.email as string, `Factory marked ready — order ${order.order_number}`, `<p>The factory marked order <strong>${order.order_number}</strong> as <strong>ready</strong> and uploaded an invoice. The order has moved to the Ready stage; the invoice is attached to the order (internal).</p>`, { tenantId, fromName: (tenant?.business_name as string) || undefined })
  } catch { /* ignore notification failure */ }
  return { ok: true }
}

// Explicit, founder-only "Send to Production" (never automatic). If a factory approval exists, notify the
// factory that the order is confirmed and they can upload an invoice + mark it ready — via a FRESH link
// (we never stored the original raw token, so the delivery link is a rotated token on the same request row).
export async function sendToProduction(orderId: string, baseUrl?: string): Promise<{ ok: boolean; error?: string }> {
  const c = await requireActiveBusinessContext(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()
  const { data } = await sb.from('orders').select('stage, order_number').eq('tenant_id', c.tenantId).eq('id', orderId).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  if (!canSendToProduction(data.stage as OrderStage)) return { ok: false, error: 'Order must be Factory Approved or Customer Approved before production.' }
  const now = new Date().toISOString()
  await sb.from('orders').update({ stage: 'production', updated_at: now }).eq('tenant_id', c.tenantId).eq('id', orderId)
  await sb.from('order_events').insert({ tenant_id: c.tenantId, order_id: orderId, type: 'sent_to_production', actor: c.actorUserId, payload: null })

  // Notify the factory (best-effort) with a fresh delivery link. Never blocks the production transition.
  try {
    const { data: fr } = await sb.from('order_approval_requests').select('id, recipient_email').eq('tenant_id', c.tenantId).eq('order_id', orderId).eq('approval_type', 'factory').eq('status', 'approved').order('version', { ascending: false }).limit(1).maybeSingle()
    if (fr?.recipient_email && baseUrl) {
      const { token, hash } = generateApprovalToken()
      await sb.from('order_approval_requests').update({ token_hash: hash, updated_at: now }).eq('tenant_id', c.tenantId).eq('id', fr.id as string)
      const { data: tenant } = await sb.from('tenants').select('business_name, email').eq('id', c.tenantId).maybeSingle()
      const bizName = (tenant?.business_name as string) || 'Our team'
      const html = deliveryRequestEmailHtml({ businessName: bizName, orderNumber: (data.order_number as string) ?? '', message: null, link: `${baseUrl}/approval/${token}`, supportEmail: (tenant?.email as string) ?? null })
      await sendEmail(fr.recipient_email as string, `Order ${data.order_number} confirmed — upload invoice when ready`, html, { tenantId: c.tenantId, fromName: bizName, replyTo: (tenant?.email as string) ?? undefined })
      await sb.from('order_events').insert({ tenant_id: c.tenantId, order_id: orderId, type: 'delivery_requested', actor: c.actorUserId, payload: null })
    }
  } catch { /* ignore notification failure */ }
  return { ok: true }
}
