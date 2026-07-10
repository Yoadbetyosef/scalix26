import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos } from '@/lib/partner/roles'

// White Label setup wizard state (business identity, default retail per plan, launched flag).
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await createAdminClient().from('partners').select('wl_business, wl_retail_defaults, wl_setup_complete, company_name').eq('id', ctx.partnerId).maybeSingle()
  return NextResponse.json({
    wl_business: data?.wl_business || {}, wl_retail_defaults: data?.wl_retail_defaults || {},
    wl_setup_complete: !!data?.wl_setup_complete, company_name: data?.company_name || null,
  })
}

export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  if (b.wl_business && typeof b.wl_business === 'object') patch.wl_business = b.wl_business
  if (b.wl_retail_defaults && typeof b.wl_retail_defaults === 'object') patch.wl_retail_defaults = b.wl_retail_defaults
  if (typeof b.wl_setup_complete === 'boolean') patch.wl_setup_complete = b.wl_setup_complete
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  const { error } = await createAdminClient().from('partners').update(patch).eq('id', ctx.partnerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
