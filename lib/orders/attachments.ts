import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, extensionOf, tooLargeMessage, publicAttachmentKind } from './attachment-types'
import { addEvent } from './store'

// Private order attachments. The bucket is never public; files are reached only via short-lived signed URLs
// generated server-side. Metadata is RLS tenant-scoped; storage paths are prefixed by tenant + order.

export const ORDER_BUCKET = 'order-attachments'

// Size caps and the extension allowlist live in ./attachment-types (isomorphic) so the upload UI can
// enforce exactly the same rules — this module reaches next/headers and can't be imported by a client.
export { ALLOWED_EXTENSIONS, ACCEPT_ATTR, MAX_ATTACHMENT_BYTES, MAX_UPLOAD_BYTES, INVOICE_EXTENSIONS, MAX_INVOICE_BYTES, publicAttachmentKind } from './attachment-types'

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
 * A document the customer may OPEN rather than look at — a certificate, an appraisal, a warranty.
 * Everything public that is not a picture or a video and that a browser can display on its own.
 */
export interface DocumentFile { id: string; url: string; fileName: string; kind: 'pdf' }

/**
 * How a public attachment's URL is minted for a given surface.
 *
 * The owner's page signs storage URLs directly (30 minutes, plenty for open-read-print). The
 * customer's page routes every file through /e/[token]/file/[id], which re-signs at click time —
 * because a customer opens an estimate, leaves the tab open over lunch, and then clicks the
 * certificate. A signed URL minted at page load would be dead by then, and a dead certificate
 * link on a customer's document is a support call about "your software".
 */
export type AttachmentUrlFor = (a: OrderAttachment) => Promise<string | null> | string | null

/** The default: a signed storage URL. */
export const signedAttachmentUrl: AttachmentUrlFor = (a) => signedUrlFor(a.storagePath, 1800)


/** The public attachments a customer-facing document may show or link, for a tenant given explicitly. */
export async function publicDocumentMediaForTenant(
  tenantId: string, orderId: string, urlFor: AttachmentUrlFor = signedAttachmentUrl,
): Promise<{ images: DocumentImage[]; files: DocumentFile[] }> {
  const { data } = await createAdminClient()
    .from('order_attachments').select('*')
    .eq('tenant_id', tenantId).eq('order_id', orderId).eq('visibility', 'public')
    .order('created_at')
  const rows = ((data as Array<Record<string, unknown>> | null) ?? []).map(row)
  const images: DocumentImage[] = []
  const files: DocumentFile[] = []
  for (const a of rows) {
    const kind = publicAttachmentKind(a.mimeType)
    if (!kind) continue
    const url = await urlFor(a)
    if (!url) continue
    if (kind === 'pdf') files.push({ id: a.id, url, fileName: a.fileName, kind })
    else images.push({ id: a.id, url, fileName: a.fileName, kind })
  }
  return { images, files }
}

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
  // ── VIDEO IS ADMITTED HERE, AND NOWHERE ELSE HAD TO CHANGE ──────────────────────────────────────
  //
  // Video has been an accepted UPLOAD since the attachment allowlist was written (mp4, mov, webm,
  // m4v). What stopped it reaching a customer was one filter: `mimeType.startsWith('image/')`. So a
  // jeweller could attach a turning shot of a ring, see it on her own order, mark it public, and it
  // would silently never appear on the document. PDFs had the same fate for the same reason, and
  // are now the `files` half of publicDocumentMediaForTenant — the certificate she promised the
  // customer, finally on the customer's copy.
  //
  // The visibility rule is untouched and is doing the same job for every kind: 'internal' is
  // filtered out in the query, so a supplier's invoice PDF can no more reach an estimate than a
  // supplier's invoice photo can.
  return (await publicDocumentMediaForTenant(tenantId, orderId)).images
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

/**
 * Remove a file — unless a document a customer was sent still names it.
 *
 * A sent estimate is a record (document-snapshot.ts). Deleting the photograph or the certificate
 * it lists would take that file off a copy the customer holds, silently. So the delete is refused
 * with the reason, and the owner's way to stop a customer seeing a file is to make it INTERNAL:
 * the sent copy then withholds it (documentDataFromSnapshot), and the bytes stay for the record.
 */
export async function deleteAttachment(id: string): Promise<{ ok: boolean; error?: string }> {
  const c = await requireActiveBusinessContext(); if (!c) return { ok: false, error: 'Not signed in' }
  const sb = await createClient()
  const { data } = await sb.from('order_attachments').select('storage_path, order_id').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  const { attachmentIdsInSnapshots } = await import('./document-snapshot')
  if ((await attachmentIdsInSnapshots(c.tenantId, data.order_id as string)).has(id)) {
    return { ok: false, error: 'This file is on a document that was sent to a customer, so it is kept for the record. Make it internal instead — the sent copy will no longer show it.' }
  }
  await createAdminClient().storage.from(ORDER_BUCKET).remove([data.storage_path as string])
  await sb.from('order_attachments').delete().eq('tenant_id', c.tenantId).eq('id', id)
  return { ok: true }
}
