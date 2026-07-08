import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canViewPipeline } from '@/lib/partner/roles'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewPipeline(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const db = createAdminClient()
  const { data: lead } = await db.from('crm_leads').select('*').eq('id', id).eq('partner_id', ctx.partnerId).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: activities } = await db.from('crm_activities').select('*').eq('lead_id', id).order('created_at', { ascending: false })
  return NextResponse.json({ lead, activities: activities || [] })
}
