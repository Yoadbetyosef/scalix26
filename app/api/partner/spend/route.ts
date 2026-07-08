import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canViewFinance, canWriteVia } from '@/lib/partner/roles'

const PLATFORMS = ['meta', 'google', 'tiktok', 'linkedin', 'other']

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data } = await db.from('partner_spend').select('id, campaign_id, platform, amount_cents, spend_date, note, created_at').eq('partner_id', ctx.partnerId).order('spend_date', { ascending: false }).limit(200)
  return NextResponse.json({ spend: data || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(ctx) || !canWriteVia(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.amount_cents) return NextResponse.json({ error: 'Amount required' }, { status: 400 })
  const { error } = await createAdminClient().from('partner_spend').insert({
    partner_id: ctx.partnerId, campaign_id: b.campaign_id || null,
    platform: PLATFORMS.includes(b.platform) ? b.platform : 'other',
    amount_cents: Math.round(Number(b.amount_cents)), spend_date: b.spend_date || new Date().toISOString().slice(0, 10),
    source: 'manual', note: b.note || null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await createAdminClient().from('partner_spend').delete().eq('id', id).eq('partner_id', ctx.partnerId)
  return NextResponse.json({ success: true })
}
