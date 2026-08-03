import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrdersAccess } from '@/lib/orders/guard'

const MAX_BYTES = 5 * 1024 * 1024
// SVG is deliberately absent: the catalog-images bucket doesn't accept image/svg+xml, and it is a public
// bucket — an SVG can carry script, so it has no business being served from one.
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

// POST /api/orders/logo-upload — multipart { file } → stores the business logo and returns its public URL,
// for use on Estimates and Quotes. Mirrors /api/studio/upload, gated on the `orders` module instead.
export async function POST(req: NextRequest) {
  const a = await requireOrdersAccess()
  if (!a) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  const ext = EXT[file.type]
  if (!ext) return NextResponse.json({ error: `Unsupported image type (${file.type || 'unknown'}). Use PNG, JPG or WEBP.` }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image is too large (max 5MB).' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const path = `${a.tenantId}/${crypto.randomUUID()}.${ext}`
  const db = createAdminClient()
  const { error } = await db.storage.from('catalog-images').upload(path, buf, { contentType: file.type, upsert: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data } = db.storage.from('catalog-images').getPublicUrl(path)
  return NextResponse.json({ url: data.publicUrl })
}
