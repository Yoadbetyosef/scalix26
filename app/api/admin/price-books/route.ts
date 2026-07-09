import { NextRequest, NextResponse } from 'next/server'
import { getAdminContext, canWrite } from '@/lib/admin/rbac'
import { createAdminClient } from '@/lib/supabase/server'
import { logAdminAction } from '@/lib/admin/audit'

// White Label / Reseller price books + items. Separate from commission_plans (affiliates/agencies).
export async function GET() {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  const [{ data: books }, { data: items }, { data: partners }] = await Promise.all([
    db.from('partner_price_books').select('*').order('created_at', { ascending: true }),
    db.from('partner_price_book_items').select('*').order('sort_order'),
    db.from('partners').select('price_book_id').not('price_book_id', 'is', null),
  ])
  const usage: Record<string, number> = {}
  for (const p of partners || []) usage[p.price_book_id] = (usage[p.price_book_id] || 0) + 1
  const withItems = (books || []).map((b) => ({ ...b, items: (items || []).filter((i) => i.price_book_id === b.id), partner_count: usage[b.id] || 0 }))
  return NextResponse.json({ books: withItems })
}

export async function POST(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const db = createAdminClient()
  if (b.kind === 'book') {
    if (!b.name || !['white_label', 'reseller'].includes(b.billing_mode)) return NextResponse.json({ error: 'name + billing_mode required' }, { status: 400 })
    const { data, error } = await db.from('partner_price_books').insert({ name: b.name, billing_mode: b.billing_mode, description: b.description || null }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await logAdminAction(ctx.email, { action: 'price_book.create', targetType: 'price_book', targetId: data.id, after: { name: b.name } })
    return NextResponse.json({ success: true, id: data.id })
  }
  if (b.kind === 'item') {
    if (!b.price_book_id || !b.plan_name || !b.plan_code) return NextResponse.json({ error: 'price_book_id + plan_name + plan_code required' }, { status: 400 })
    const { error } = await db.from('partner_price_book_items').insert({
      price_book_id: b.price_book_id, plan_name: b.plan_name, plan_code: b.plan_code,
      wholesale_price_cents: b.wholesale_price_cents ?? 0, suggested_retail_price_cents: b.suggested_retail_price_cents ?? 0,
      setup_fee_cents: b.setup_fee_cents ?? null, included_ai_employees: b.included_ai_employees ?? null,
      included_phone_numbers: b.included_phone_numbers ?? null, notes: b.notes || null, sort_order: b.sort_order ?? 0,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }
  return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = createAdminClient()
  if (b.kind === 'book') {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const f of ['name', 'description', 'is_active', 'billing_mode']) if (f in b) patch[f] = b[f]
    const { error } = await db.from('partner_price_books').update(patch).eq('id', b.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  }
  const patch: Record<string, unknown> = {}
  for (const f of ['plan_name', 'plan_code', 'wholesale_price_cents', 'suggested_retail_price_cents', 'setup_fee_cents', 'included_ai_employees', 'included_phone_numbers', 'notes', 'sort_order', 'is_active']) if (f in b) patch[f] = b[f]
  const { error } = await db.from('partner_price_book_items').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx || !canWrite(ctx.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(req.url)
  const id = url.searchParams.get('id'); const kind = url.searchParams.get('kind')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = createAdminClient()
  await db.from(kind === 'item' ? 'partner_price_book_items' : 'partner_price_books').delete().eq('id', id)
  return NextResponse.json({ success: true })
}
