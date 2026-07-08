import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'

// Content-based asset library. Every asset carries real copy (content) so it previews in-app and
// downloads as a file — never a broken external link.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const search = url.searchParams.get('q')?.trim()
  const collection = url.searchParams.get('collection')?.trim()
  const db = createAdminClient()

  let query = db.from('marketing_assets').select('id, title, description, category, collection, file_url, content, tags, updated_at, download_count').eq('active', true).order('collection').order('title')
  if (collection) query = query.eq('collection', collection)
  if (search) query = query.textSearch('search_tsv', search, { type: 'websearch' })
  const [{ data: assets }, { data: favs }] = await Promise.all([
    query,
    db.from('partner_asset_favorites').select('asset_id').eq('partner_id', ctx.partnerId),
  ])
  const favSet = new Set((favs || []).map((f) => f.asset_id))
  const collections = [...new Set((assets || []).map((a) => a.collection).filter(Boolean))]
  return NextResponse.json({
    assets: (assets || []).map((a) => ({ ...a, favorited: favSet.has(a.id) })),
    collections,
  })
}

// Increment the download counter (best-effort analytics).
export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (id) {
    const db = createAdminClient()
    const { data } = await db.from('marketing_assets').select('download_count').eq('id', id).maybeSingle()
    await db.from('marketing_assets').update({ download_count: (data?.download_count || 0) + 1 }).eq('id', id)
  }
  return NextResponse.json({ ok: true })
}

// Toggle favorite.
export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { assetId, favorite } = await req.json().catch(() => ({}))
  if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })
  const db = createAdminClient()
  if (favorite) await db.from('partner_asset_favorites').upsert({ partner_id: ctx.partnerId, asset_id: assetId }, { onConflict: 'partner_id,asset_id', ignoreDuplicates: true })
  else await db.from('partner_asset_favorites').delete().eq('partner_id', ctx.partnerId).eq('asset_id', assetId)
  return NextResponse.json({ ok: true })
}
