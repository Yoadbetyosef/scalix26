import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticatePartnerRequest } from '@/lib/partner/api-auth'
import { canCreateDemos } from '@/lib/partner/roles'
import { resolvePartnerEconomics } from '@/lib/partner/economics-resolve'
import { summaryFromAggregate } from '@/lib/partner/wholesale'

const PAGE_SIZE = 25

// White-label / reseller client accounts — built for scale: paginated + searchable list, KPIs from a
// SQL aggregate (never sums rows in the app). Overlay on partner↔tenant; never the commission ledger.
export async function GET(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createAdminClient()
  const url = new URL(req.url)
  const page = Math.max(1, Number(url.searchParams.get('page') || 1))
  const q = url.searchParams.get('q')?.trim()
  const status = url.searchParams.get('status')?.trim()
  const plan = url.searchParams.get('plan')?.trim()
  const from = (page - 1) * PAGE_SIZE, to = from + PAGE_SIZE - 1

  let query = db.from('partner_clients')
    .select('id, business_name, tenant_id, plan_code, retail_price_cents, wholesale_price_cents, status, created_at, tenants(business_name)', { count: 'exact' })
    .eq('partner_id', ctx.partnerId).order('created_at', { ascending: false }).range(from, to)
  if (q) query = query.ilike('business_name', `%${q}%`)
  if (status) query = query.eq('status', status)
  if (plan) query = query.eq('plan_code', plan)

  const [{ data: rows, count }, { data: aggRows }, econ, importableCount] = await Promise.all([
    query,
    db.rpc('partner_wholesale_summary', { p_partner: ctx.partnerId }),
    resolvePartnerEconomics(ctx.partnerId),
    countImportable(db, ctx.partnerId),
  ])
  const clients = (rows || []).map((c) => ({
    id: c.id, tenant_id: c.tenant_id, plan_code: c.plan_code, retail_price_cents: c.retail_price_cents,
    wholesale_price_cents: c.wholesale_price_cents, status: c.status, created_at: c.created_at,
    business_name: c.business_name || (c.tenants as unknown as { business_name?: string } | null)?.business_name || 'Client',
  }))
  const agg = (Array.isArray(aggRows) ? aggRows[0] : aggRows) || { active_clients: 0, total_clients: 0, monthly_retail_cents: 0, monthly_wholesale_cents: 0, new_this_month: 0, churned_clients: 0, priced_clients: 0 }
  const summary = summaryFromAggregate(agg)

  return NextResponse.json({
    clients, page, pageSize: PAGE_SIZE, total: count ?? 0, summary,
    priceBook: econ.priceBook, overrides: { discount: econ.customWholesaleDiscountPct, markup: econ.retailMarkupPct },
    importableCount,
  })
}

// Approximate count for the "Import N paid" hint — O(1) head counts, never loads rows.
async function countImportable(db: ReturnType<typeof createAdminClient>, partnerId: string): Promise<number> {
  const [{ count: paid }, { count: linked }] = await Promise.all([
    db.from('referrals').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('status', 'paid').not('tenant_id', 'is', null),
    db.from('partner_clients').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).not('tenant_id', 'is', null),
  ])
  return Math.max(0, (paid ?? 0) - (linked ?? 0))
}

export async function POST(req: NextRequest) {
  const ctx = await authenticatePartnerRequest(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canCreateDemos(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const db = createAdminClient()

  if (b.import) {
    const { data: existing } = await db.from('partner_clients').select('tenant_id').eq('partner_id', ctx.partnerId).not('tenant_id', 'is', null)
    const have = new Set((existing || []).map((e) => e.tenant_id))
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
  const db = createAdminClient()

  // Bulk update (status / plan) across selected clients.
  if (Array.isArray(b.ids) && b.ids.length) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (b.status && ['prospect', 'active', 'paused', 'churned'].includes(b.status)) patch.status = b.status
    if ('plan_code' in b) patch.plan_code = b.plan_code
    if ('retail_price_cents' in b) patch.retail_price_cents = b.retail_price_cents
    if ('wholesale_price_cents' in b) patch.wholesale_price_cents = b.wholesale_price_cents
    const { error } = await db.from('partner_clients').update(patch).in('id', b.ids).eq('partner_id', ctx.partnerId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, updated: b.ids.length })
  }

  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const f of ['business_name', 'plan_code', 'price_book_item_id', 'retail_price_cents', 'wholesale_price_cents']) if (f in b) patch[f] = b[f]
  if (b.status && ['prospect', 'active', 'paused', 'churned'].includes(b.status)) patch.status = b.status
  const { error } = await db.from('partner_clients').update(patch).eq('id', b.id).eq('partner_id', ctx.partnerId)
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
