import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCore } from '@/lib/core/guard'

// POST /api/core/uploads — multipart { file } → stores it in the tenant's folder of the existing
// `catalog-images` public bucket and returns a stable public URL. Reuses the catalog storage pattern (no
// duplicate storage). Commerce-gated + tenant-scoped path. The URL is then stored on product_media.
const MAX_BYTES = 10 * 1024 * 1024
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

export async function POST(req: NextRequest) {
  const c = await requireCore()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  const ext = EXT[file.type]
  if (!ext) return NextResponse.json({ error: `Unsupported image type (${file.type || 'unknown'}). Use JPG, PNG, WEBP or GIF.` }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image is too large (max 10MB).' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const path = `${c.tenantId}/${crypto.randomUUID()}.${ext}`
  const db = createAdminClient()
  const { error } = await db.storage.from('catalog-images').upload(path, buf, { contentType: file.type, upsert: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data } = db.storage.from('catalog-images').getPublicUrl(path)
  return NextResponse.json({ url: data.publicUrl })
}
