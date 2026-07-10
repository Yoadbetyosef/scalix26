import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos } from '@/lib/partner/roles'
import { clearBrandCache } from '@/lib/partner/brand'

const FIELDS = ['company_name', 'logo_url', 'favicon_url', 'primary_color', 'secondary_color', 'support_email', 'support_phone', 'website', 'custom_domain', 'email_footer', 'login_background_url', 'powered_by_scalix']

export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await createAdminClient().from('partner_brands').select('*').eq('partner_id', ctx.partnerId).maybeSingle()
  return NextResponse.json({ brand: data || null })
}

export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const row: Record<string, unknown> = { partner_id: ctx.partnerId, updated_at: new Date().toISOString() }
  for (const f of FIELDS) if (f in b) row[f] = b[f] === '' ? null : b[f]
  // Custom domain is unique across partners; normalize + guard.
  if (typeof row.custom_domain === 'string') row.custom_domain = (row.custom_domain as string).split(':')[0].trim().toLowerCase() || null
  const { error } = await createAdminClient().from('partner_brands').upsert(row, { onConflict: 'partner_id' })
  if (error) return NextResponse.json({ error: /duplicate|unique/i.test(error.message) ? 'That domain is already taken.' : error.message }, { status: 400 })
  clearBrandCache()
  return NextResponse.json({ success: true })
}
