import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'
import { PARTNER_TYPES } from '@/lib/partner/roles'

const TYPE_KEYS = new Set(PARTNER_TYPES.map((t) => t.key as string))
const BILLING_MODES = new Set(['revenue_share', 'reseller', 'white_label'])

// Admin: list partners with rollup stats; update status/tier.
export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.trim()
  const page = Math.max(0, Number(searchParams.get('page') || 0))
  const pageSize = 50
  let q = db.from('partners')
    .select('id, company_name, slug, partner_type, billing_mode, default_commission_plan_id, price_book_id, custom_wholesale_discount_pct, retail_markup_pct, agreement_notes, status, tier, health_score, contact_email, enabled_modules, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
  if (search) q = q.or(`company_name.ilike.%${search}%,contact_email.ilike.%${search}%,slug.ilike.%${search}%`)
  const { data: partners, count } = await q.range(page * pageSize, page * pageSize + pageSize - 1)

  const ids = (partners || []).map((p) => p.id)
  const stats: Record<string, { customers: number; pending: number; paid: number; client_count: number; providers_connected: number }> = {}
  if (ids.length) {
    const [{ data: refs }, { data: entries }, { data: clients }, { data: integrations }] = await Promise.all([
      db.from('referrals').select('partner_id, status').in('partner_id', ids),
      db.from('commission_entries').select('partner_id, amount_cents, status').in('partner_id', ids),
      db.from('partner_clients').select('partner_id').in('partner_id', ids).eq('status', 'active'),
      db.from('partner_integrations').select('partner_id').in('partner_id', ids).eq('status', 'connected'),
    ])
    for (const p of ids) stats[p] = { customers: 0, pending: 0, paid: 0, client_count: 0, providers_connected: 0 }
    for (const r of refs || []) if (r.status === 'paid') stats[r.partner_id].customers++
    for (const e of entries || []) {
      if (e.status === 'pending' || e.status === 'approved') stats[e.partner_id].pending += e.amount_cents
      if (e.status === 'paid') stats[e.partner_id].paid += e.amount_cents
    }
    for (const c of clients || []) stats[c.partner_id].client_count++
    for (const i of integrations || []) stats[i.partner_id].providers_connected++
  }
  return NextResponse.json({ partners: (partners || []).map((p) => ({ ...p, stats: stats[p.id] || { customers: 0, pending: 0, paid: 0, client_count: 0, providers_connected: 0 } })), total: count ?? 0, page, pageSize })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const { id, status, tier, enabled_modules, partner_type, billing_mode } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (status && ['pending', 'active', 'suspended', 'banned'].includes(status)) patch.status = status
  if (typeof tier === 'number') patch.tier = tier
  // Per-partner module gating. Sanitized against the known module registry; empty array = all off.
  if (Array.isArray(enabled_modules)) patch.enabled_modules = enabled_modules.filter((m) => typeof m === 'string')
  // Economics assignment (reuses existing engine — partner_type preset + resolved plan).
  if (partner_type && TYPE_KEYS.has(partner_type)) patch.partner_type = partner_type
  if (billing_mode && BILLING_MODES.has(billing_mode)) patch.billing_mode = billing_mode
  if ('default_commission_plan_id' in body) patch.default_commission_plan_id = body.default_commission_plan_id || null
  // White label / reseller: price book + optional overrides + agreement notes.
  if ('price_book_id' in body) patch.price_book_id = body.price_book_id || null
  if ('custom_wholesale_discount_pct' in body) patch.custom_wholesale_discount_pct = body.custom_wholesale_discount_pct === '' || body.custom_wholesale_discount_pct == null ? null : Number(body.custom_wholesale_discount_pct)
  if ('retail_markup_pct' in body) patch.retail_markup_pct = body.retail_markup_pct === '' || body.retail_markup_pct == null ? null : Number(body.retail_markup_pct)
  if ('agreement_notes' in body) patch.agreement_notes = body.agreement_notes || null
  const db = createAdminClient()
  const { error } = await db.from('partners').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await logAdminAction(ctx.email, { action: 'partner.update', targetType: 'partner', targetId: id, after: patch })
  return NextResponse.json({ success: true })
}
