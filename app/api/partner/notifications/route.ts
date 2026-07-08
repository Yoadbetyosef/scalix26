import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data } = await db.from('partner_notifications')
    .select('id, kind, title, body, link, read_at, created_at')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false }).limit(50)
  const unread = (data || []).filter((n) => !n.read_at).length
  return NextResponse.json({ notifications: data || [], unread })
}

// Mark one (by id) or all as read.
export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, all } = await req.json().catch(() => ({}))
  const db = createAdminClient()
  let q = db.from('partner_notifications').update({ read_at: new Date().toISOString() }).eq('partner_id', ctx.partnerId).is('read_at', null)
  if (!all && id) q = db.from('partner_notifications').update({ read_at: new Date().toISOString() }).eq('partner_id', ctx.partnerId).eq('id', id)
  await q
  return NextResponse.json({ ok: true })
}
