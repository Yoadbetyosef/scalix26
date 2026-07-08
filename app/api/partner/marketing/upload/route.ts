import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos } from '@/lib/partner/roles'

const MAX_BYTES = 10 * 1024 * 1024
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

// POST /api/partner/marketing/upload — multipart { file } → stores it in the partner's folder in the
// partner-creatives bucket and returns a stable public URL for use as a creative image/thumbnail.
export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  const ext = EXT[file.type]
  if (!ext) return NextResponse.json({ error: `Unsupported image type (${file.type || 'unknown'}). Use JPG, PNG, WEBP or GIF.` }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image is too large (max 10MB).' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const path = `${ctx.partnerId}/${crypto.randomUUID()}.${ext}`
  const db = createAdminClient()
  const { error } = await db.storage.from('partner-creatives').upload(path, buf, { contentType: file.type, upsert: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data } = db.storage.from('partner-creatives').getPublicUrl(path)
  return NextResponse.json({ url: data.publicUrl })
}
