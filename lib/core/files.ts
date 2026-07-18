import { createAdminClient } from '@/lib/supabase/server'
import type { FileRecord } from './types'

// Polymorphic file layer — attach files to ANY record (contact/company/product/order/…). Generalizes the
// order-attachments signed-URL pattern into a shared, tenant-scoped service. Private bucket by default.
const admin = () => createAdminClient()
const DEFAULT_BUCKET = 'core-files'

export interface FileInput {
  ownerType: string; ownerId: string; path: string
  filename?: string | null; contentType?: string | null; sizeBytes?: number | null
  visibility?: 'private' | 'public'; uploadedBy?: string | null; bucket?: string; metadata?: Record<string, unknown>
}

export async function recordFile(tenantId: string, f: FileInput): Promise<FileRecord | null> {
  const { data } = await admin().from('files').insert({
    tenant_id: tenantId, owner_type: f.ownerType, owner_id: f.ownerId, bucket: f.bucket ?? DEFAULT_BUCKET, path: f.path,
    filename: f.filename ?? null, content_type: f.contentType ?? null, size_bytes: f.sizeBytes ?? null,
    visibility: f.visibility ?? 'private', uploaded_by: f.uploadedBy ?? null, metadata: f.metadata ?? {},
  }).select('*').single()
  return (data as FileRecord | null) ?? null
}

export async function listFiles(tenantId: string, ownerType: string, ownerId: string): Promise<FileRecord[]> {
  const { data } = await admin().from('files').select('*').eq('tenant_id', tenantId).eq('owner_type', ownerType).eq('owner_id', ownerId).order('created_at', { ascending: false })
  return (data as FileRecord[]) ?? []
}

// Short-lived signed URL for a private file, tenant-scoped so another tenant's file id is never signable.
export async function signedUrl(tenantId: string, fileId: string, ttlSeconds = 300): Promise<string | null> {
  const { data: row } = await admin().from('files').select('bucket, path, visibility').eq('tenant_id', tenantId).eq('id', fileId).maybeSingle()
  if (!row) return null
  const db = admin()
  if (row.visibility === 'public') return db.storage.from(row.bucket as string).getPublicUrl(row.path as string).data.publicUrl
  const { data } = await db.storage.from(row.bucket as string).createSignedUrl(row.path as string, ttlSeconds)
  return data?.signedUrl ?? null
}

export async function deleteFile(tenantId: string, fileId: string): Promise<boolean> {
  const { data: row } = await admin().from('files').select('bucket, path').eq('tenant_id', tenantId).eq('id', fileId).maybeSingle()
  if (!row) return false
  await admin().storage.from(row.bucket as string).remove([row.path as string]).catch(() => {})
  const { error } = await admin().from('files').delete().eq('tenant_id', tenantId).eq('id', fileId)
  return !error
}
