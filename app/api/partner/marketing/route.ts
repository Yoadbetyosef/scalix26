import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const search = new URL(req.url).searchParams.get('q')?.trim()
  const db = createAdminClient()
  let query = db.from('marketing_assets').select('id, title, description, category, file_url, thumbnail_url, tags, download_count').eq('active', true).order('created_at', { ascending: false })
  if (search) query = query.textSearch('search_tsv', search, { type: 'websearch' })
  const { data } = await query
  return NextResponse.json({ assets: data || [] })
}

// Increment download counter (best-effort).
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
