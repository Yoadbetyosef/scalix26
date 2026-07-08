import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canEditMarketplace } from '@/lib/partner/roles'
import { logPartnerAction } from '@/lib/partner/audit'

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const { data } = await db.from('marketplace_profiles').select('*').eq('partner_id', ctx.partnerId).maybeSingle()
  return NextResponse.json({ profile: data || null, slug: ctx.slug })
}

export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditMarketplace(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const row: Record<string, unknown> = { partner_id: ctx.partnerId, updated_at: new Date().toISOString() }
  for (const f of ['headline', 'bio', 'logo_url', 'website']) if (f in b) row[f] = b[f]
  for (const f of ['specialties', 'regions', 'languages']) if (f in b) row[f] = Array.isArray(b[f]) ? b[f] : String(b[f] || '').split(',').map((s: string) => s.trim()).filter(Boolean)
  if ('listed' in b) row.listed = !!b.listed
  const db = createAdminClient()
  const { data, error } = await db.from('marketplace_profiles').upsert(row, { onConflict: 'partner_id' }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logPartnerAction(ctx.partnerId, ctx.userId, { action: 'marketplace.updated', targetType: 'marketplace_profile', after: { listed: row.listed } })
  return NextResponse.json({ profile: data })
}
