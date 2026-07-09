import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos } from '@/lib/partner/roles'
import { resolvePartnerEconomics, getPartnerClients, computeWholesaleSummary } from '@/lib/partner/economics-resolve'

// White-label / reseller client accounts. Overlay on the existing partner↔tenant relation; never
// touches the commission ledger. All money comes from the assigned price book + per-client pricing.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const [clients, econ] = await Promise.all([getPartnerClients(ctx.partnerId), resolvePartnerEconomics(ctx.partnerId)])
  const summary = computeWholesaleSummary(clients)

  // Paid referrals not yet tracked as clients — offered for one-click import.
  const linkedTenantIds = new Set(clients.map((c) => c.tenant_id).filter(Boolean))
  const { data: refs } = await db.from('referrals').select('tenant_id, tenants(business_name)').eq('partner_id', ctx.partnerId).eq('status', 'paid').not('tenant_id', 'is', null)
  const importable = (refs || [])
    .filter((r) => !linkedTenantIds.has(r.tenant_id))
    .map((r) => ({ tenant_id: r.tenant_id as string, business_name: (r.tenants as unknown as { business_name?: string } | null)?.business_name || 'Client' }))

  return NextResponse.json({
    clients, summary, priceBook: econ.priceBook, importableCount: importable.length, importable,
    overrides: { discount: econ.customWholesaleDiscountPct, markup: econ.retailMarkupPct },
  })
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const db = createAdminClient()

  // Bulk import paid referrals as active client accounts (pricing set later).
  if (b.import) {
    const { data: existing } = await db.from('partner_clients').select('tenant_id').eq('partner_id', ctx.partnerId)
    const have = new Set((existing || []).map((e) => e.tenant_id).filter(Boolean))
    const { data: refs } = await db.from('referrals').select('tenant_id, tenants(business_name)').eq('partner_id', ctx.partnerId).eq('status', 'paid').not('tenant_id', 'is', null)
    const rows = (refs || []).filter((r) => !have.has(r.tenant_id)).map((r) => ({
      partner_id: ctx.partnerId, tenant_id: r.tenant_id, business_name: (r.tenants as unknown as { business_name?: string } | null)?.business_name || 'Client', status: 'active',
    }))
    if (rows.length) await db.from('partner_clients').insert(rows)
    return NextResponse.json({ success: true, imported: rows.length })
  }

  if (!b.business_name?.trim() && !b.tenant_id) return NextResponse.json({ error: 'business_name or tenant_id required' }, { status: 400 })
  const { error } = await db.from('partner_clients').insert({
    partner_id: ctx.partnerId, tenant_id: b.tenant_id || null, business_name: b.business_name?.trim() || null,
    price_book_item_id: b.price_book_item_id || null, plan_code: b.plan_code || null,
    retail_price_cents: b.retail_price_cents ?? null, wholesale_price_cents: b.wholesale_price_cents ?? null,
    status: ['prospect', 'active', 'paused', 'churned'].includes(b.status) ? b.status : 'active',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const f of ['business_name', 'plan_code', 'price_book_item_id', 'retail_price_cents', 'wholesale_price_cents']) if (f in b) patch[f] = b[f]
  if (b.status && ['prospect', 'active', 'paused', 'churned'].includes(b.status)) patch.status = b.status
  const { error } = await createAdminClient().from('partner_clients').update(patch).eq('id', b.id).eq('partner_id', ctx.partnerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await createAdminClient().from('partner_clients').delete().eq('id', id).eq('partner_id', ctx.partnerId)
  return NextResponse.json({ success: true })
}
