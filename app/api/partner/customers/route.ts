import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'

// The partner's referred customers (tenants), with their referral status + lifetime commission.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()

  const { data: refs } = await db.from('referrals')
    .select('id, tenant_id, status, converted_at, created_at, tenants(business_name, plan, created_at)')
    .eq('partner_id', ctx.partnerId).neq('status', 'rejected').order('created_at', { ascending: false })

  // Lifetime commission per tenant.
  const tenantIds = (refs || []).map((r) => r.tenant_id).filter(Boolean) as string[]
  const byTenant: Record<string, number> = {}
  if (tenantIds.length) {
    const { data: entries } = await db.from('commission_entries').select('tenant_id, amount_cents, status').eq('partner_id', ctx.partnerId).in('tenant_id', tenantIds)
    for (const e of entries || []) if (e.tenant_id) byTenant[e.tenant_id] = (byTenant[e.tenant_id] || 0) + (e.status === 'paid' ? e.amount_cents : 0)
  }

  const customers = (refs || []).map((r) => {
    const t = r.tenants as unknown as { business_name?: string; plan?: string; created_at?: string } | null
    return {
      id: r.id, tenant_id: r.tenant_id, business_name: t?.business_name || 'Unknown',
      plan: t?.plan || 'trial', status: r.status, converted_at: r.converted_at,
      signed_up_at: t?.created_at || r.created_at, lifetime_commission_cents: byTenant[r.tenant_id as string] || 0,
    }
  })
  return NextResponse.json({ customers })
}
