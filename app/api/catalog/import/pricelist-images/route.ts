import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'

// POST /api/catalog/import/pricelist-images — the pictures that go with an imported price list.
//
// A chunk of small JPEGs, each with the product codes it belongs to (one photo often serves several
// finishes of the same piece). Each is stored once and set as the photo of every product in this
// business with one of those codes THAT HAS NO PHOTO YET — a photo somebody took themselves is never
// replaced by a supplier's thumbnail. Safe to send twice.
export const maxDuration = 60

const schema = z.object({
  images: z.array(z.object({ data: z.string().min(100).max(400_000), skus: z.array(z.string().min(1).max(80)).min(1).max(60) })).min(1).max(60),
})

export async function POST(req: NextRequest) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'That file is not a set of pictures we can read.' }, { status: 400 })

  const db = createAdminClient()
  let stored = 0, updated = 0
  const failed: string[] = []
  // A few at a time: fast enough to finish a chunk well inside the limit, gentle on storage.
  const queue = [...parsed.data.images]
  async function worker() {
    for (let img = queue.shift(); img; img = queue.shift()) {
      const buf = Buffer.from(img.data, 'base64')
      // JPEG only — these come from our own extraction, and the magic bytes are the cheap proof.
      if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) { failed.push(img.skus[0]); continue }
      const path = `${s!.tenantId}/pricelist/${createHash('sha1').update(buf).digest('hex').slice(0, 20)}.jpg`
      const up = await db.storage.from('catalog-images').upload(path, buf, { contentType: 'image/jpeg', upsert: true })
      if (up.error) { failed.push(img.skus[0]); continue }
      stored += 1
      const url = db.storage.from('catalog-images').getPublicUrl(path).data.publicUrl
      const { data: rows, error } = await db.from('catalog_products').update({ image_url: url, updated_at: new Date().toISOString() })
        .eq('tenant_id', s!.tenantId).in('sku', img.skus).is('image_url', null).select('id')
      if (error) { failed.push(img.skus[0]); continue }
      const ids = (rows ?? []).map((r) => r.id as string)
      updated += ids.length
      if (!ids.length) continue
      // Studio's own photo list, where it is still empty — it is what a product's public page shows.
      const { data: studio } = await db.from('studio_products').select('id, photos').eq('tenant_id', s!.tenantId).in('catalog_product_id', ids)
      const empty = ((studio ?? []) as { id: string; photos: string[] | null }[]).filter((x) => !x.photos?.length).map((x) => x.id)
      if (empty.length) await db.from('studio_products').update({ photos: [url] }).eq('tenant_id', s!.tenantId).in('id', empty)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return NextResponse.json({ ok: true, received: parsed.data.images.length, stored, updated, failed })
}
