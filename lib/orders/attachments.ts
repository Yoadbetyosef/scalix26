import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { ALLOWED_EXTENSIONS, MAX_ATTACHMENT_BYTES, extensionOf } from './attachment-types'
import { addEvent } from './store'

// Private order attachments. The bucket is never public; files are reached only via short-lived signed URLs
// generated server-side. Metadata is RLS tenant-scoped; storage paths are prefixed by tenant + order.

export const ORDER_BUCKET = 'order-attachments'

// Size caps and the extension allowlist live in ./attachment-types (isomorphic) so the upload UI can
// enforce exactly the same rules — this module reaches next/headers and can't be imported by a client.
export { ALLOWED_EXTENSIONS, ACCEPT_ATTR, MAX_ATTACHMENT_BYTES, INVOICE_EXTENSIONS, MAX_INVOICE_BYTES } from './attachment-types'

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

export async function uploadAttachment(orderId: string, file: File): Promise<{ ok: boolean; error?: string; attachment?: OrderAttachment }> {
  const c = await requireActiveBusinessContext(); if (!c) return { ok: false, error: 'unauthorized' }
  const ext = extensionOf(file.name)
  const storedType = ALLOWED_EXTENSIONS[ext]
  if (!storedType) return { ok: false, error: `Can't accept a .${ext || 'unknown'} file. Photos, PDFs, videos and CAD files (STL, OBJ, 3DM, STEP, ZIP…) are all supported.` }
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB — the limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` }
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
