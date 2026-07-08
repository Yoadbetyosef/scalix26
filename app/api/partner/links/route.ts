import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canWriteVia } from '@/lib/partner/rbac'
import { logPartnerAction } from '@/lib/partner/audit'
import { awardXp, XP } from '@/lib/partner/xp'

function newCode(): string {
  // Short, URL-safe, unambiguous.
  return randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
}

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data: links } = await db.from('referral_links')
    .select('id, code, label, destination_path, utm, click_count, created_at')
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false })

  // Attach conversion counts (signups + paid) per link's referrals via last_touch.
  const ids = (links || []).map((l) => l.id)
  const conv: Record<string, { signups: number; paid: number }> = {}
  if (ids.length) {
    const { data: refs } = await db.from('referrals').select('last_touch_link_id, status').in('last_touch_link_id', ids)
    for (const r of refs || []) {
      const k = r.last_touch_link_id as string
      conv[k] ||= { signups: 0, paid: 0 }
      conv[k].signups++
      if (r.status === 'paid') conv[k].paid++
    }
  }
  return NextResponse.json({ links: (links || []).map((l) => ({ ...l, conversions: conv[l.id] || { signups: 0, paid: 0 } })) })
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canWriteVia(ctx)) return NextResponse.json({ error: 'This API key is read-only.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const db = createAdminClient()

  // Retry a couple of times on the (rare) code collision.
  let code = ''
  for (let i = 0; i < 4; i++) {
    code = newCode()
    const { data: exists } = await db.from('referral_links').select('id').eq('code', code).maybeSingle()
    if (!exists) break
    code = ''
  }
  if (!code) return NextResponse.json({ error: 'Could not allocate a code, try again.' }, { status: 500 })

  const utm: Record<string, string> = {}
  if (body.utm && typeof body.utm === 'object') for (const [k, v] of Object.entries(body.utm)) if (v) utm[k] = String(v)

  const { data: link, error } = await db.from('referral_links').insert({
    partner_id: ctx.partnerId,
    code,
    label: body.label || null,
    destination_path: body.destination_path || '/auth/signup',
    campaign_id: body.campaign_id || null,
    utm,
  }).select('id, code, label, destination_path, click_count, created_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'link.created', targetType: 'referral_link', targetId: link.id, after: { code, label: body.label } })
  await awardXp(ctx.partnerId, 'first_link', XP.first_link, { uniqueKey: `first_link:${ctx.partnerId}`, userId: ctx.userId })
  return NextResponse.json({ success: true, link: { ...link, conversions: { signups: 0, paid: 0 } } })
}
