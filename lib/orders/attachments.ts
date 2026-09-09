import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, extensionOf, tooLargeMessage } from './attachment-types'
import { addEvent } from './store'

// Private order attachments. The bucket is never public; files are reached only via short-lived signed URLs
// generated server-side. Metadata is RLS tenant-scoped; storage paths are prefixed by tenant + order.

export const ORDER_BUCKET = 'order-attachments'

// Size caps and the extension allowlist live in ./attachment-types (isomorphic) so the upload UI can
// enforce exactly the same rules — this module reaches next/headers and can't be imported by a client.
export { ALLOWED_EXTENSIONS, ACCEPT_ATTR, MAX_ATTACHMENT_BYTES, MAX_UPLOAD_BYTES, INVOICE_EXTENSIONS, MAX_INVOICE_BYTES } from './attachment-types'

export type Visibility = 'internal' | 'public'
export interface OrderAttachment { id: string; orderId: string; storagePath: string; fileName: string; mimeType: string; fileSize: number; visibility: Visibility; uploadedBy: string | null; createdAt: string }

const row = (r: Record<string, unknown>): OrderAttachment => ({ id: r.id as string, orderId: r.order_id as string, storagePath: r.storage_path as string, fileName: r.file_name as string, mimeType: r.mime_type as string, fileSize: Number(r.file_size ?? 0), visibility: r.visibility as Visibility, uploadedBy: (r.uploaded_by as string) ?? null, createdAt: r.created_at as string })

export async function listAttachments(orderId: string): Promise<OrderAttachment[]> {
  const c = await requireActiveBusinessContext(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('order_attachments').select('*').eq('tenant_id', c.tenantId).eq('order_id', orderId).order('created_at')
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(row)
}

// Short-lived signed URL (default 5 min). Server-side only; the bucket stays private.
export async function signedUrlFor(storagePath: string, expiresIn = 300): Promise<string | null> {
  const { data } = await createAdminClient().storage.from(ORDER_BUCKET).createSignedUrl(storagePath, expiresIn)
  return data?.signedUrl ?? null
}

/**
 * An attachment the customer may see, with a URL that will still resolve when they print.
 *
 * `kind` was added when video arrived. It is derived from the stored MIME type rather than stored, so
 * there is nothing to migrate and nothing that can disagree with the file itself.
 */
export interface DocumentImage { id: string; url: string; fileName: string; kind: 'image' | 'video' }

/**
 * The images a CUSTOMER-facing document may show, for a tenant given EXPLICITLY.
 *
 * ── WHY THIS TAKES A TENANT INSTEAD OF READING A SESSION ────────────────────────────────────────────
 *
 * It used to call listAttachments(), which resolves tenancy from requireActiveBusinessContext() and
 * reads with the cookie-scoped client. On /e/[token] there is no session, so it returned an empty
 * array — and an empty gallery is INVISIBLE: the document renders, looks complete, and simply has no
 * photograph of the ring on it. The owner sees the image, the customer does not, and nothing errors.
 *
 * That is the same fault as getOrder() one layer deeper, and it is the more dangerous of the two
 * because the first one 404'd loudly while this one silently ships a worse document.
 *
 * Tenancy is now an argument, proved by the share token, and the read is the admin client under an
 * explicit tenant_id filter — which, with RLS bypassed, is the only thing scoping it.
 *
 * Two filters remain, both load-bearing:
 *   visibility === 'public'  — 'internal' is the default, so a supplier invoice uploaded to the order
 *                              can never appear on the customer's estimate.
 *   an image mime type       — a PDF or CAD file has no thumbnail and would print as a broken box.
 *
 * The signed URL lasts 30 minutes rather than the usual 5: a document is opened, read, and THEN
 * printed, and an expired URL prints as a blank rectangle on the customer's copy.
 */
export async function publicDocumentImagesForTenant(tenantId: string, orderId: string): Promise<DocumentImage[]> {
  const { data } = await createAdminClient()
    .from('order_attachments').select('*')
    .eq('tenant_id', tenantId).eq('order_id', orderId).eq('visibility', 'public')
    .order('created_at')

  // ── VIDEO IS ADMITTED HERE, AND NOWHERE ELSE HAD TO CHANGE ──────────────────────────────────────
  //
  // Video has been an accepted UPLOAD since the attachment allowlist was written (mp4, mov, webm,
  // m4v). What stopped it reaching a customer was this one filter: `mimeType.startsWith('image/')`.
  // So a jeweller could attach a turning shot of a ring, see it on her own order, mark it public, and
  // it would silently never appear on the document — the failure mode this function's own comment
  // warns about, one line below where it was happening.
  //
  // The visibility rule is untouched and is doing the same job for video that it does for a photo:
  // 'internal' is filtered out above, in the query, so a supplier's invoice video could no more reach
  // an estimate than a supplier's invoice PDF can.
  //
  // HEIC/HEIF stay out of the picture set for the same reason they always were — no browser renders
  // them — and everything else (PDF, CAD, ZIP) still has no thumbnail and is still excluded.
  const kindOf = (mime: string): 'image' | 'video' | null => {
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('image/') && mime !== 'image/heic' && mime !== 'image/heif') return 'image'
    return null
  }

  const media = ((data as Array<Record<string, unknown>> | null) ?? [])
    .map(row)
    .map((a) => ({ a, kind: kindOf(a.mimeType) }))
    .filter((x): x is { a: OrderAttachment; kind: 'image' | 'video' } => x.kind !== null)

  const signed = await Promise.all(media.map(async ({ a, kind }) => {
    const url = await signedUrlFor(a.storagePath, 1800)
    return url ? { id: a.id, url, fileName: a.fileName, kind } : null
  }))
  return signed.filter((x): x is DocumentImage => x !== null)
}

/** The owner-facing read: tenancy from the signed-in workspace. Never use on a public route. */
export async function publicDocumentImages(orderId: string): Promise<DocumentImage[]> {
  const c = await requireActiveBusinessContext()
  if (!c) return []
  return publicDocumentImagesForTenant(c.tenantId, orderId)
}

export async function uploadAttachment(orderId: string, file: File): Promise<{ ok: boolean; error?: string; attachment?: OrderAttachment }> {
  const c = await requireActiveBusinessContext(); if (!c) return { ok: false, error: 'unauthorized' }
  const ext = extensionOf(file.name)
  const storedType = ALLOWED_EXTENSIONS[ext]
  if (!storedType) return { ok: false, error: `Can't accept a .${ext || 'unknown'} file. Photos, PDFs, videos and CAD files (STL, OBJ, 3DM, STEP, ZIP…) are all supported.` }
  // The limit the PLATFORM keeps, not the bucket's — a file between the two uploaded and then died
  // at the edge with an uncatchable plain-text 413. See MAX_UPLOAD_BYTES.
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: tooLargeMessage(file.size, storedType.startsWith('video/')) }
  // Confirm the order belongs to this tenant before writing anything.
  const sb = await createClient()
  const { data: order } = await sb.from('orders').select('id').eq('tenant_id', c.tenantId).eq('id', orderId).maybeSingle()
  if (!order) return { ok: false, error: 'not found' }

  // Stored under our own content type, never the browser's claim — the uploader doesn't get to decide
  // how the file is served back.
  const path = `${c.tenantId}/${orderId}/${crypto.randomUUID()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  const up = await createAdminClient().storage.from(ORDER_BUCKET).upload(path, buf, { contentType: storedType, upsert: false })
  if (up.error) return { ok: false, error: up.error.message }
  // Shared by default. A file the jeweller attaches to an order IS the reference material for the piece —
  // defaulting it to internal meant the photo the factory most needed sat on the order unseen, behind a
  // second action that was easy to miss. Anything genuinely private is one click to make internal.
  // (The factory's own invoice upload stays internal — see submitFactoryDelivery.)
  const { data, error } = await sb.from('order_attachments').insert({ tenant_id: c.tenantId, order_id: orderId, storage_path: path, file_name: file.name.slice(0, 200), mime_type: storedType, file_size: file.size, uploaded_by: c.actorUserId, visibility: 'public' }).select('*').single()
  if (error) { await createAdminClient().storage.from(ORDER_BUCKET).remove([path]); return { ok: false, error: error.message } }
  await addEvent(orderId, 'attachment_added', { fileName: file.name })
  return { ok: true, attachment: row(data as Record<string, unknown>) }
}

export async function setAttachmentVisibility(id: string, visibility: Visibility): Promise<boolean> {
  const c = await requireActiveBusinessContext(); if (!c) return false
  const sb = await createClient()
  const { error } = await sb.from('order_attachments').update({ visibility }).eq('tenant_id', c.tenantId).eq('id', id)
  return !error
}

export async function deleteAttachment(id: string): Promise<boolean> {
  const c = await requireActiveBusinessContext(); if (!c) return false
  const sb = await createClient()
  const { data } = await sb.from('order_attachments').select('storage_path, order_id').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!data) return false
  await createAdminClient().storage.from(ORDER_BUCKET).remove([data.storage_path as string])
  await sb.from('order_attachments').delete().eq('tenant_id', c.tenantId).eq('id', id)
  return true
}
