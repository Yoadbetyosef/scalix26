import { createAdminClient } from '@/lib/supabase/server'
import { ORDER_BUCKET, type AttachmentUrlFor, type DocumentImage, type DocumentFile } from './attachments'
import { loadOrderDocument, type OrderDocumentData } from './document-data'
import type { OrderDocType } from './documents'

// ── A SENT DOCUMENT IS A RECORD. THE ORDER IS NOT. ──────────────────────────────────────────────
//
// Estimate, quote and invoice are renderings of the one orders row, so the OWNER's copy is always
// live: edit the order and the document she opens next reflects it. That is right for her. It is
// wrong for the customer, who was sent a link on Tuesday and must find on Friday exactly what they
// were sent on Tuesday — a price that quietly changed under a link is a dispute, not a bug report.
//
// So the moment a link is minted (emailed or copied), the document as rendered THEN is written to
// the private order bucket as JSON, beside the order's files, keyed by the share's id:
//
//   <tenant>/<order>/snapshots/<shareId>.json
//
// and the customer's page renders the snapshot when it exists, the live order only for links minted
// before snapshots existed. No table changed: the share row already carries the ids, the bucket
// already exists and is already private, and the token route already validates every file the
// snapshot names against the order it belongs to.
//
// What is frozen: every field the document prints — lines, specs, prices, tax, deposit, branding,
// letterhead, the list of images and certificates. What is NOT frozen: the file bytes themselves
// (a photo re-uploaded under the same id is the same attachment) and the share's revocation, which
// still ends the link.
//
// The owner can open any sent copy from the Shared links panel ("View as sent"), so what the
// customer holds is never a guess.

export const SNAPSHOT_VERSION = 1

export interface DocumentSnapshot {
  version: number
  capturedAt: string
  docType: OrderDocType
  order: OrderDocumentData['order']
  branding: OrderDocumentData['branding']
  business: OrderDocumentData['business']
  images: Array<{ id: string; fileName: string; kind: DocumentImage['kind'] }>
  files: Array<{ id: string; fileName: string; kind: DocumentFile['kind'] }>
  tax: OrderDocumentData['tax']
  pstExemptionNote: string | null
  footerNote: string | null
  templateName: string | null
}

export const snapshotPath = (tenantId: string, orderId: string, shareId: string): string =>
  `${tenantId}/${orderId}/snapshots/${shareId}.json`

/**
 * Render the document as it is right now and freeze it under the share's id. Best-effort by
 * contract: a failure here must not stop the link going out (the customer then sees the live
 * document, which is today's behaviour), but it is logged, because a link without a frozen copy is
 * a link whose history cannot be proved.
 */
export async function writeDocumentSnapshot(tenantId: string, orderId: string, shareId: string, docType: OrderDocType): Promise<{ ok: boolean; error?: string }> {
  try {
    // Ids in place of URLs: the snapshot must not carry a signed URL that dies in thirty minutes.
    const data = await loadOrderDocument(tenantId, orderId, docType, (a) => `id:${a.id}`)
    if (!data) return { ok: false, error: 'order not found' }
    const snap: DocumentSnapshot = {
      version: SNAPSHOT_VERSION, capturedAt: new Date().toISOString(), docType,
      order: data.order, branding: data.branding, business: data.business,
      images: data.images.map((i) => ({ id: i.id, fileName: i.fileName, kind: i.kind })),
      files: data.files.map((f) => ({ id: f.id, fileName: f.fileName, kind: f.kind })),
      tax: data.tax, pstExemptionNote: data.pstExemptionNote, footerNote: data.footerNote, templateName: data.templateName,
    }
    const { error } = await createAdminClient().storage.from(ORDER_BUCKET)
      // application/octet-stream, NOT application/json: the bucket allows only the file types an
      // order carries (images, PDF, video, zip, octet-stream), and the first version of this wrote
      // application/json — every snapshot was silently refused and every link fell back to the
      // live order. We read the bytes back ourselves; the content type is nothing to anyone else.
      .upload(snapshotPath(tenantId, orderId, shareId), Buffer.from(JSON.stringify(snap)), { contentType: 'application/octet-stream', upsert: true })
    if (error) { console.error('[orders] document snapshot not written', { orderId, shareId, error: error.message }); return { ok: false, error: error.message } }
    return { ok: true }
  } catch (e) {
    console.error('[orders] document snapshot failed', { orderId, shareId, error: (e as Error).message })
    return { ok: false, error: (e as Error).message }
  }
}

/** The frozen copy for a share, or null for links minted before snapshots existed. */
export async function readDocumentSnapshot(tenantId: string, orderId: string, shareId: string): Promise<DocumentSnapshot | null> {
  const { data, error } = await createAdminClient().storage.from(ORDER_BUCKET).download(snapshotPath(tenantId, orderId, shareId))
  if (error || !data) return null
  try {
    const snap = JSON.parse(await data.text()) as DocumentSnapshot
    return snap && snap.version === SNAPSHOT_VERSION && snap.order ? snap : null
  } catch {
    return null
  }
}

/**
 * Every attachment id that ANY sent copy of this order still names. The set a delete must respect:
 * removing one of these files would silently take a photograph or a certificate off a document a
 * customer is holding. Read from the snapshots folder itself, so there is no second list to drift.
 */
export async function attachmentIdsInSnapshots(tenantId: string, orderId: string): Promise<Set<string>> {
  const db = createAdminClient()
  const { data: objects } = await db.storage.from(ORDER_BUCKET).list(`${tenantId}/${orderId}/snapshots`, { limit: 1000 })
  const ids = new Set<string>()
  for (const o of objects ?? []) {
    if (!o.name.endsWith('.json')) continue
    const { data } = await db.storage.from(ORDER_BUCKET).download(`${tenantId}/${orderId}/snapshots/${o.name}`)
    if (!data) continue
    try {
      const snap = JSON.parse(await data.text()) as DocumentSnapshot
      for (const x of [...(snap.images ?? []), ...(snap.files ?? [])]) ids.add(x.id)
    } catch { /* an unreadable snapshot protects nothing and blocks nothing */ }
  }
  return ids
}

/**
 * Turn a snapshot back into what the document body renders, with URLs minted for THIS surface —
 * the token route for the customer, signed URLs for the owner's "view as sent".
 */
export async function documentDataFromSnapshot(snap: DocumentSnapshot, urlFor: AttachmentUrlFor, tenantId: string, orderId: string): Promise<OrderDocumentData> {
  const db = createAdminClient()
  const ids = [...snap.images, ...snap.files].map((x) => x.id)
  // Storage paths for the ids the snapshot names — only those still on THIS order. A file deleted
  // since is simply absent from the rendered copy (the bytes are gone; nothing can show them).
  const { data } = ids.length
    ? await db.from('order_attachments').select('id, storage_path, file_name, mime_type, file_size, visibility, uploaded_by, created_at, order_id').eq('tenant_id', tenantId).eq('order_id', orderId).in('id', ids)
    : { data: [] as Array<Record<string, unknown>> }
  // Only files that are still PUBLIC: a file the owner has since made internal is withheld from the
  // rendered copy rather than listed with a link that would refuse to open. The withholding is the
  // one deliberate way a sent copy changes, and it changes only by omission.
  const rows = new Map(((data as Array<Record<string, unknown>> | null) ?? []).filter((r) => r.visibility === 'public').map((r) => [r.id as string, r]))
  const urlOf = async (id: string) => {
    const r = rows.get(id)
    if (!r) return null
    return urlFor({ id, orderId, storagePath: r.storage_path as string, fileName: r.file_name as string, mimeType: r.mime_type as string, fileSize: Number(r.file_size ?? 0), visibility: r.visibility as 'internal' | 'public', uploadedBy: (r.uploaded_by as string) ?? null, createdAt: r.created_at as string })
  }
  const images: DocumentImage[] = []
  for (const i of snap.images) { const url = await urlOf(i.id); if (url) images.push({ ...i, url }) }
  const files: DocumentFile[] = []
  for (const f of snap.files) { const url = await urlOf(f.id); if (url) files.push({ ...f, url }) }
  return { order: snap.order, branding: snap.branding, business: snap.business, images, files, tax: snap.tax, pstExemptionNote: snap.pstExemptionNote, footerNote: snap.footerNote, templateName: snap.templateName }
}
