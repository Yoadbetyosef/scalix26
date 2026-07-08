import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canEditPipeline } from '@/lib/partner/roles'

const KINDS = ['note', 'call', 'email', 'sms', 'task']

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPipeline(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
  const db = createAdminClient()
  // Ownership check via the lead's partner.
  const { data: lead } = await db.from('crm_leads').select('id').eq('id', b.lead_id).eq('partner_id', ctx.partnerId).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data, error } = await db.from('crm_activities').insert({
    partner_id: ctx.partnerId, lead_id: b.lead_id, actor_id: ctx.userId,
    kind: KINDS.includes(b.kind) ? b.kind : 'note',
    body: b.body || null, due_at: b.due_at || null,
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await db.from('crm_leads').update({ updated_at: new Date().toISOString() }).eq('id', b.lead_id)
  return NextResponse.json({ activity: data })
}
