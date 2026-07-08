import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos, canWriteVia } from '@/lib/partner/roles'

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await createAdminClient().from('campaigns').select('*').eq('partner_id', ctx.partnerId).order('created_at', { ascending: false })
  return NextResponse.json({ campaigns: data || [] })
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx) || !canWriteVia(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const { data, error } = await createAdminClient().from('campaigns').insert({
    partner_id: ctx.partnerId, name: b.name, objective: b.objective || null, channel: b.channel || null,
    status: b.status || 'active', budget_cents: b.budget_cents ?? null, starts_at: b.starts_at || null, ends_at: b.ends_at || null,
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ campaign: data })
}

export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  for (const f of ['name', 'objective', 'channel', 'status', 'budget_cents', 'starts_at', 'ends_at']) if (f in b) patch[f] = b[f]
  const { error } = await createAdminClient().from('campaigns').update(patch).eq('id', b.id).eq('partner_id', ctx.partnerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
